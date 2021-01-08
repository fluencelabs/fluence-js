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

import { v4 as uuidv4 } from 'uuid';
import { fromByteArray, toByteArray } from 'base64-js';
import PeerId from 'peer-id';
import { encode } from 'bs58';

const DEFAULT_TTL = 7000;

export interface Particle {
    id: string;
    init_peer_id: string;
    timestamp: number;
    ttl: number;
    script: string;
    // sign upper fields
    signature: string;
    data: Uint8Array;
}

/**
 * Represents particle action to send to a node
 */
interface ParticleAction {
    action: 'Particle';
    id: string;
    init_peer_id: string;
    timestamp: number;
    ttl: number;
    script: string;
    signature: number[];
    data: string;
}

function wrapScript(selfPeerId: string, script: string, fields: string[]): string {
    fields.forEach((v) => {
        script = `
(seq
    (call %init_peer_id% ("" "load") ["${v}"] ${v})
    ${script}
)
                 `;
    });

    return script;
}

export async function build(peerId: PeerId, script: string, data?: Map<string, any>, ttl?: number): Promise<Particle> {
    let id = genUUID();
    let currentTime = new Date().getTime();

    if (data === undefined) {
        data = new Map();
    }

    if (ttl === undefined) {
        ttl = DEFAULT_TTL;
    }

    script = wrapScript(peerId.toB58String(), script, Array.from(data.keys()));

    let particle: Particle = {
        id: id,
        init_peer_id: peerId.toB58String(),
        timestamp: currentTime,
        ttl: ttl,
        script: script,
        signature: '',
        data: Buffer.from([]),
    };

    particle.signature = await signParticle(peerId, particle);

    return particle;
}

/**
 * Creates an action to send to a node.
 */
export function toAction(particle: Particle): ParticleAction {
    return {
        action: 'Particle',
        id: particle.id,
        init_peer_id: particle.init_peer_id,
        timestamp: particle.timestamp,
        ttl: particle.ttl,
        script: particle.script,
        // TODO: copy signature from a particle after signatures will be implemented on nodes
        signature: [],
        data: fromByteArray(particle.data),
    };
}

export function parseParticle(str: string): Particle {
    let json = JSON.parse(str);

    return {
        id: json.id,
        init_peer_id: json.init_peer_id,
        timestamp: json.timestamp,
        ttl: json.ttl,
        script: json.script,
        signature: json.signature,
        data: toByteArray(json.data),
    };
}

export function canonicalBytes(particle: Particle) {
    let peerIdBuf = Buffer.from(particle.init_peer_id, 'utf8');
    let idBuf = Buffer.from(particle.id, 'utf8');

    let tsArr = new ArrayBuffer(8);
    new DataView(tsArr).setBigUint64(0, BigInt(particle.timestamp));
    let tsBuf = Buffer.from(tsArr);

    let ttlArr = new ArrayBuffer(4);
    new DataView(ttlArr).setUint32(0, particle.ttl);
    let ttlBuf = Buffer.from(ttlArr);

    let scriptBuf = Buffer.from(particle.script, 'utf8');

    return Buffer.concat([peerIdBuf, idBuf, tsBuf, ttlBuf, scriptBuf]);
}

/**
 * Sign a particle with a private key from peerId.
 */
export async function signParticle(peerId: PeerId, particle: Particle): Promise<string> {
    let bufToSign = canonicalBytes(particle);

    let signature = await peerId.privKey.sign(bufToSign);
    return encode(signature);
}

export function genUUID() {
    return uuidv4();
}