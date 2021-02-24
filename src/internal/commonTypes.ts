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

export interface CallServiceResult {
    ret_code: number;
    result: string;
}

export type ParticleHandler = (
    serviceId: string,
    fnName: string,
    args: any[],
    tetraplets: SecurityTetraplet[][],
) => CallServiceResult;

export interface StepperOutcome {
    ret_code: number;
    data: Uint8Array;
    next_peer_pks: string[];
    error_message: string;
}

export interface ResolvedTriplet {
    peer_pk: string;
    service_id: string;
    function_name: string;
}

export interface SecurityTetraplet extends ResolvedTriplet {
    json_path: string;
}

export type PeerIdB58 = string;
