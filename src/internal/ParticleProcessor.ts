/*
 * Copyright 2020 Fluence Labs Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ParticleDto } from './particle';
import * as PeerId from 'peer-id';
import { instantiateInterpreter, InterpreterInvoke } from './stepper';
import { ParticleHandler, SecurityTetraplet, StepperOutcome } from './commonTypes';
import log from 'loglevel';
import { ParticleProcessorStrategy } from './ParticleProcessorStrategy';

// HACK:: make an api for aqua stepper to accept variables in an easy way!
let magicParticleStorage: Map<string, Map<string, any>> = new Map();

// HACK:: make an api for aqua stepper to accept variables in an easy way!
export function injectDataIntoParticle(particleId: string, data: Map<string, any>, ttl: number) {
    console.trace(`setting data for ${particleId}`, data);
    magicParticleStorage.set(particleId, data);
    setTimeout(() => {
        console.trace(`data for ${particleId} is deleted`);
        magicParticleStorage.delete(particleId);
    }, ttl);
}

// HACK:: make an api for aqua stepper to accept variables in an easy way!
const wrapWithDataInjectionHandling = (
    handler: ParticleHandler,
    getCurrentParticleId: () => string,
): ParticleHandler => {
    return (serviceId: string, fnName: string, args: any[], tetraplets: SecurityTetraplet[][]) => {
        if (serviceId === '__magic' && fnName === 'load') {
            const current = getCurrentParticleId();
            const data = magicParticleStorage.get(current);

            const res = data ? data.get(args[0]) : {};
            return {
                ret_code: 0,
                result: JSON.stringify(res),
            };
        }

        return handler(serviceId, fnName, args, tetraplets);
    };
};

export class ParticleProcessor {
    private interpreter: InterpreterInvoke;
    private subscriptions: Map<string, ParticleDto> = new Map();
    private particlesQueue: ParticleDto[] = [];
    private currentParticle?: string;

    strategy: ParticleProcessorStrategy;
    peerId: PeerId;

    constructor(strategy: ParticleProcessorStrategy, peerId: PeerId) {
        this.strategy = strategy;
        this.peerId = peerId;
    }

    async init() {
        await this.instantiateInterpreter();
    }

    async destroy() {
        // TODO: destroy interpreter
    }

    async executeLocalParticle(particle: ParticleDto) {
        this.strategy?.onLocalParticleRecieved(particle);
        await this.handleParticle(particle).catch((err) => {
            console.error('particle processing failed: ' + err);
        });
    }

    async executeExternalParticle(particle: ParticleDto) {
        this.strategy?.onExternalParticleRecieved(particle);
        await this.handleExternalParticle(particle);
    }

    /*
     * private
     */

    private getCurrentParticleId(): string | undefined {
        return this.currentParticle;
    }

    private setCurrentParticleId(particle: string | undefined) {
        this.currentParticle = particle;
    }

    private enqueueParticle(particle: ParticleDto): void {
        this.particlesQueue.push(particle);
    }

    private popParticle(): ParticleDto | undefined {
        return this.particlesQueue.pop();
    }

    /**
     * Subscriptions will be applied by outside message if id will be the same.
     *
     * @param particle
     * @param ttl time to live, subscription will be deleted after this time
     */
    subscribe(particle: ParticleDto, ttl: number) {
        let self = this;
        setTimeout(() => {
            self.subscriptions.delete(particle.id);
            self.strategy?.onParticleTimeout(particle, Date.now());
        }, ttl);
        this.subscriptions.set(particle.id, particle);
    }

    updateSubscription(particle: ParticleDto): boolean {
        if (this.subscriptions.has(particle.id)) {
            this.subscriptions.set(particle.id, particle);
            return true;
        } else {
            return false;
        }
    }

    getSubscription(id: string): ParticleDto | undefined {
        return this.subscriptions.get(id);
    }

    hasSubscription(particle: ParticleDto): boolean {
        return this.subscriptions.has(particle.id);
    }

    /**
     * Pass a particle to a interpreter and send a result to other services.
     */
    private async handleParticle(particle: ParticleDto): Promise<void> {
        // if a current particle is processing, add new particle to the queue
        if (this.getCurrentParticleId() !== undefined && this.getCurrentParticleId() !== particle.id) {
            this.enqueueParticle(particle);
        } else {
            if (this.interpreter === undefined) {
                throw new Error('Undefined. Interpreter is not initialized');
            }
            // start particle processing if queue is empty
            try {
                this.setCurrentParticleId(particle.id);
                // check if a particle is relevant
                let now = Date.now();
                let actualTtl = particle.timestamp + particle.ttl - now;
                if (actualTtl <= 0) {
                    this.strategy?.onParticleTimeout(particle, now);
                } else {
                    // if there is no subscription yet, previous data is empty
                    let prevData: Uint8Array = Buffer.from([]);
                    let prevParticle = this.getSubscription(particle.id);
                    if (prevParticle) {
                        prevData = prevParticle.data;
                        // update a particle in a subscription
                        this.updateSubscription(particle);
                    } else {
                        // set a particle with actual ttl
                        this.subscribe(particle, actualTtl);
                    }
                    this.strategy.onStepperExecuting(particle);
                    let stepperOutcomeStr = this.interpreter(
                        particle.init_peer_id,
                        particle.script,
                        prevData,
                        particle.data,
                    );
                    let stepperOutcome: StepperOutcome = JSON.parse(stepperOutcomeStr);

                    // update data after aquamarine execution
                    let newParticle: ParticleDto = { ...particle, data: stepperOutcome.data };
                    this.strategy.onStepperExecuted(stepperOutcome);

                    this.updateSubscription(newParticle);

                    // do nothing if there is no `next_peer_pks` or if client isn't connected to the network
                    if (stepperOutcome.next_peer_pks.length > 0) {
                        this.strategy.sendParticleFurther(newParticle);
                    }
                }
            } finally {
                // get last particle from the queue
                let nextParticle = this.popParticle();
                // start the processing of a new particle if it exists
                if (nextParticle) {
                    // update current particle
                    this.setCurrentParticleId(nextParticle.id);
                    await this.handleParticle(nextParticle);
                } else {
                    // wait for a new call (do nothing) if there is no new particle in a queue
                    this.setCurrentParticleId(undefined);
                }
            }
        }
    }

    /**
     * Handle incoming particle from a relay.
     */
    private async handleExternalParticle(particle: ParticleDto): Promise<void> {
        let data: any = particle.data;
        let error: any = data['protocol!error'];
        if (error !== undefined) {
            console.error('error in external particle: ', error);
        } else {
            await this.handleParticle(particle);
        }
    }

    /**
     * Instantiate WebAssembly with AIR interpreter to execute AIR scripts
     */
    async instantiateInterpreter() {
        this.interpreter = await instantiateInterpreter(
            wrapWithDataInjectionHandling(
                this.strategy.particleHandler.bind(this),
                this.getCurrentParticleId.bind(this),
            ),
            this.peerId,
        );
    }
}
