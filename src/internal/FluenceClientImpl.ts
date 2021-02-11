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

import log from 'loglevel';
import PeerId from 'peer-id';
import { SecurityTetraplet, StepperOutcome } from './commonTypes';
import { FluenceClientBase } from './FluenceClientBase';
import { FluenceClient } from '../FluenceClient';
import { build, genUUID, ParticleDto } from './particle';
import { ParticleProcessor } from './ParticleProcessor';
import { ParticleProcessorStrategy } from './ParticleProcessorStrategy';

const fetchCallbackServiceName = '__callback';
const selfRelayVarName = '__relay';

const wrapRelayBasedCall = (script: string) => {
    return `
    (seq
        (call ${selfRelayVarName} ("op" "identity") [])
        ${script}
    )
    `;
};

const wrapFetchCall = (script: string, particleId: string, resultArgNames: string[]) => {
    // TODO: sanitize
    const resultTogether = resultArgNames.join(' ');
    let res = `
    (seq
        ${script}
        (seq
            (call ${selfRelayVarName} ("op" "identity") [])
            (call %init_peer_id%  ("${fetchCallbackServiceName}" "${particleId}") [${resultTogether}])
        )
    )`;
    return wrapRelayBasedCall(res);
};

export interface FluenceEvent {
    type: string;
    args: any[];
}

export type FluenceEventHandler = (event: FluenceEvent) => void;

export class FluenceClientImpl extends FluenceClientBase implements FluenceClient {
    private eventSubscribers: Map<string, FluenceEventHandler[]> = new Map();
    private eventValidators: Map<string, Function> = new Map();
    private callbacks: Map<string, Function> = new Map();
    private fetchParticles: Map<string, { resolve: Function; reject: Function }> = new Map();

    constructor(selfPeerId: PeerId) {
        super(selfPeerId);
        this.processor = new ParticleProcessor(this.strategy, selfPeerId);
    }

    async fetch<T>(script: string, resultArgNames: string[], data?: Map<string, any>, ttl?: number): Promise<T> {
        data = this.addRelayToArgs(data);
        const callBackId = genUUID();
        script = wrapFetchCall(script, callBackId, resultArgNames);
        const particle = await build(this.selfPeerIdFull, script, data, ttl, callBackId);

        return new Promise<T>((resolve, reject) => {
            this.fetchParticles.set(callBackId, { resolve, reject });
            this.processor.executeLocalParticle(particle);
        });
    }

    // TODO:: better naming probably?
    async fireAndForget(script: string, data?: Map<string, any>, ttl?: number) {
        data = this.addRelayToArgs(data);
        script = wrapRelayBasedCall(script);

        await this.sendScript(script, data, ttl);
    }

    registerEvent(
        channel: string,
        eventName: string,
        validate?: (channel: string, eventName: string, args: any[], tetraplets: any[][]) => boolean,
    ) {
        if (!validate) {
            validate = (c, e, a, t) => true;
        }

        this.eventValidators.set(`${channel}/${eventName}`, validate);
    }

    unregisterEvent(channel: string, eventName: string) {
        this.eventValidators.delete(`${channel}/${eventName}`);
    }

    registerCallback(
        serviceId: string,
        fnName: string,
        callback: (args: any[], tetraplets: SecurityTetraplet[][]) => object,
    ) {
        this.callbacks.set(`${serviceId}/${fnName}`, callback);
    }

    unregisterCallback(channel: string, eventName: string) {
        this.eventValidators.delete(`${channel}/${eventName}`);
    }

    subscribe(channel: string, handler: FluenceEventHandler) {
        if (!this.eventSubscribers.get(channel)) {
            this.eventSubscribers.set(channel, []);
        }

        this.eventSubscribers.get(channel).push(handler);
    }

    protected strategy: ParticleProcessorStrategy = {
        particleHandler: (serviceId: string, fnName: string, args: any[], tetraplets: SecurityTetraplet[][]) => {
            // missing built-in op
            if (serviceId === 'op' && fnName === 'identity') {
                return {
                    ret_code: 0,
                    result: JSON.stringify(args),
                };
            }

            // async fetch model handling
            if (serviceId === fetchCallbackServiceName) {
                const executingParticlePromiseFns = this.fetchParticles.get(fnName);
                if (executingParticlePromiseFns) {
                    // don't block
                    setTimeout(() => {
                        this.fetchParticles.delete(fnName);
                        executingParticlePromiseFns.resolve(args);
                    }, 0);
                }

                return {
                    ret_code: 0,
                    result: JSON.stringify({}),
                };
            }

            // event model handling
            const eventPair = `${serviceId}/${fnName}`;
            const eventValidator = this.eventValidators.get(eventPair);
            if (eventValidator) {
                try {
                    if (!eventValidator(serviceId, fnName, args, tetraplets)) {
                        return {
                            ret_code: 1, // TODO:: error codes
                            result: 'validation failed',
                        };
                    }
                } catch (e) {
                    console.error('error running validation function: ' + e);
                    return {
                        ret_code: 1, // TODO:: error codes
                        result: 'validation failed',
                    };
                }

                // don't block
                setTimeout(() => {
                    this.pushEvent(serviceId, {
                        type: fnName,
                        args: args,
                    });
                }, 0);

                return {
                    ret_code: 0,
                    result: JSON.stringify({}),
                };
            }

            // callback model handling
            const callback = this.callbacks.get(eventPair);
            if (callback) {
                try {
                    const res = callback(args, tetraplets);
                    return {
                        ret_code: 0,
                        result: JSON.stringify(res),
                    };
                } catch (e) {
                    return {
                        ret_code: 1, // TODO:: error codes
                        result: JSON.stringify(e),
                    };
                }
            }

            return {
                ret_code: 1,
                result: `Error. There is no service: ${serviceId}`,
            };
        },

        sendParticleFurther: async (particle: ParticleDto) => {
            try {
                await this.connection.sendParticle(particle);
            } catch (reason) {
                console.error(`Error on sending particle with id ${particle.id}: ${reason}`);
            }
        },

        onParticleTimeout: (particle: ParticleDto, now: number) => {
            console.info(`Particle expired. Now: ${now}, ttl: ${particle.ttl}, ts: ${particle.timestamp}`);
            const executingParticle = this.fetchParticles.get(particle.id);
            if (executingParticle) {
                executingParticle.reject(new Error(`particle ${particle.id} timed out`));
            }
        },
        onLocalParticleRecieved: (particle: ParticleDto) => {
            console.debug('local particle received', particle);
        },
        onExternalParticleRecieved: (particle: ParticleDto) => {
            console.debug('external particle received', particle);
        },
        onStepperExecuting: (particle: ParticleDto) => {
            console.debug('stepper executing particle', particle);
        },
        onStepperExecuted: (stepperOutcome: StepperOutcome) => {
            console.debug('inner interpreter outcome:', stepperOutcome);
        },
    };

    private pushEvent(channel: string, event: FluenceEvent) {
        const subs = this.eventSubscribers.get(channel);
        if (subs) {
            for (let sub of subs) {
                sub(event);
            }
        }
    }

    private addRelayToArgs(data: Map<string, any>) {
        if (data === undefined) {
            data = new Map();
        }

        if (!data.has(selfRelayVarName)) {
            data.set(selfRelayVarName, this.relayPeerId);
        }

        return data;
    }
}
