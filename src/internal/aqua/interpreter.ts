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

import { toByteArray } from 'base64-js';
import * as aqua from '.';
import { return_current_peer_id, return_call_service_result, getStringFromWasm0, free } from '.';
import { ParticleHandler, CallServiceResult, SecurityTetraplet } from '../commonTypes';

import PeerId from 'peer-id';
import log from 'loglevel';
import wasmBs64 from '@fluencelabs/aquamarine-interpreter';

// prettier-ignore
type InterpreterInvoke = (
    init_peer_id: string,
    script: string,
    prev_data: Uint8Array,
    data: Uint8Array,
) => string;

type ImportObject = {
    './aquamarine_client_bg.js': {
        // fn call_service_impl(service_id: String, fn_name: String, args: String, security_tetraplets: String) -> String;
        // prettier-ignore
        __wbg_callserviceimpl_d9f9208b7e581e24: (arg0: any, arg1: any, arg2: any, arg3: any, arg4: any, arg5: any, arg6: any, arg7: any, arg8: any, ) => void;
        __wbg_getcurrentpeeridimpl_c6a63062490312cd: (arg0: any) => void;
        __wbindgen_throw: (arg: any) => void;
    };
    host: LogImport;
};

type LogImport = {
    log_utf8_string: (level: any, target: any, offset: any, size: any) => void;
};

type Exports = any;
type Instance = any;
type ExportValue = any;

class HostImportsConfig {
    exports: Exports | undefined;
    newImportObject: () => ImportObject;

    constructor(create: (cfg: HostImportsConfig) => ImportObject) {
        this.exports = undefined;
        this.newImportObject = () => create(this);
    }

    setExports(exports: Exports) {
        this.exports = exports;
    }
}

const interpreter_wasm = toByteArray(wasmBs64);

/// Instantiates WebAssembly runtime with AIR interpreter module
async function interpreterInstance(cfg: HostImportsConfig): Promise<Instance> {
    /// Create host imports that use module exports internally
    let imports = cfg.newImportObject();

    /// Instantiate interpreter
    let interpreter_module = await WebAssembly.compile(interpreter_wasm);
    let instance: Instance = await WebAssembly.instantiate(interpreter_module, imports);

    /// Set exports, so host imports can use them
    cfg.setExports(instance.exports);

    /// Trigger interpreter initialization (i.e., call main function)
    call_export(instance.exports.main);

    return instance;
}

/// If export is a function, call it. Otherwise log a warning.
/// NOTE: any here is unavoidable, see Function interface definition
function call_export(f: ExportValue, ...argArray: any[]): any {
    if (typeof f === 'function') {
        return f();
    } else {
        log.warn(`can't call export ${f}: it is not a function, but ${typeof f}`);
    }
}

function log_import(cfg: HostImportsConfig): LogImport {
    return {
        log_utf8_string: (level: any, target: any, offset: any, size: any) => {
            let wasm = cfg.exports;
            try {
                let str = getStringFromWasm0(wasm, offset, size);

                switch (level) {
                    case 1:
                        log.error(str);
                        break;
                    case 2:
                        log.warn(str);
                        break;
                    case 3:
                        log.info(str);
                        break;
                    case 4:
                        log.debug(str);
                        break;
                    case 5:
                        // we don't want a trace in trace logs
                        log.debug(str);
                        break;
                }
            } finally {
            }
        },
    };
}

const theParticleHandler = (
    callback: ParticleHandler,
    service_id: string,
    fn_name: string,
    args: string,
    tetraplets: string,
): CallServiceResult => {
    let argsObject;
    let tetrapletsObject: SecurityTetraplet[][];
    try {
        argsObject = JSON.parse(args);
        if (!Array.isArray(argsObject)) {
            throw new Error('args is not an array');
        }

        tetrapletsObject = JSON.parse(tetraplets);
    } catch (err) {
        log.error('Cannot parse arguments: ' + JSON.stringify(err));
        return {
            result: JSON.stringify('Cannot parse arguments: ' + JSON.stringify(err)),
            ret_code: 1,
        };
    }

    return callback(service_id, fn_name, argsObject, tetrapletsObject);
};

/// Returns import object that describes host functions called by AIR interpreter
function newImportObject(particleHandler: ParticleHandler, cfg: HostImportsConfig, peerId: PeerId): ImportObject {
    return {
        // __wbg_callserviceimpl_c0ca292e3c8c0c97 this is a function generated by bindgen. Could be changed.
        // If so, an error with a new name will be occurred after wasm initialization.
        './aquamarine_client_bg.js': {
            // prettier-ignore
            __wbg_callserviceimpl_d9f9208b7e581e24: (arg0: any, arg1: any, arg2: any, arg3: any, arg4: any, arg5: any, arg6: any, arg7: any, arg8: any) => {
                let wasm = cfg.exports;
                try {
                    let serviceId = getStringFromWasm0(wasm, arg1, arg2);
                    let fnName = getStringFromWasm0(wasm, arg3, arg4);
                    let args = getStringFromWasm0(wasm, arg5, arg6);
                    let tetraplets = getStringFromWasm0(wasm, arg7, arg8);
                    /*
                     TODO:: parse and pack arguments into structure like the following
                     class Argument<T> {
                        value: T,
                        SecurityTetraplet: tetraplet
                     }
                    */
                    let serviceResult = theParticleHandler(particleHandler, serviceId, fnName, args, tetraplets);
                    let resultStr = JSON.stringify(serviceResult);
                    return_call_service_result(wasm, resultStr, arg0);
                } finally {
                    free(wasm, arg1, arg2);
                    free(wasm, arg3, arg4);
                    free(wasm, arg5, arg6);
                    free(wasm, arg7, arg8);
                }
            },
            __wbg_getcurrentpeeridimpl_c6a63062490312cd: (arg0: any) => {
                let peerIdStr = peerId.toB58String();
                let wasm = cfg.exports;
                return_current_peer_id(wasm, peerIdStr, arg0);
            },
            __wbindgen_throw: (arg: any) => {
                log.error(`wbindgen throw: ${JSON.stringify(arg)}`);
            },
        },
        host: log_import(cfg),
    };
}

function newLogImport(cfg: HostImportsConfig): ImportObject {
    return {
        host: log_import(cfg),
        './aquamarine_client_bg.js': {
            __wbg_callserviceimpl_d9f9208b7e581e24: (_) => {},
            __wbg_getcurrentpeeridimpl_c6a63062490312cd: (_) => {},
            __wbindgen_throw: (_) => {},
        },
    };
}

/// Instantiates AIR interpreter, and returns its `invoke` function as closure
async function instantiateInterpreter(particleHandler: ParticleHandler, peerId: PeerId): Promise<InterpreterInvoke> {
    let cfg = new HostImportsConfig((cfg) => {
        return newImportObject(particleHandler, cfg, peerId);
    });
    let instance = await interpreterInstance(cfg);

    return (init_peer_id: string, script: string, prev_data: Uint8Array, data: Uint8Array) => {
        let logLevel = log.getLevel();
        let logLevelStr = 'info';
        if (logLevel === 0) {
            logLevelStr = 'trace';
        } else if (logLevel === 1) {
            logLevelStr = 'debug';
        } else if (logLevel === 2) {
            logLevelStr = 'info';
        } else if (logLevel === 3) {
            logLevelStr = 'warn';
        } else if (logLevel === 4) {
            logLevelStr = 'error';
        } else if (logLevel === 5) {
            logLevelStr = 'off';
        }

        return aqua.invoke(instance.exports, init_peer_id, script, prev_data, data, logLevelStr);
    };
}

/// Instantiate AIR interpreter with host imports containing only logger, but not call_service
/// peerId isn't actually required for AST parsing, but host imports require it, and I don't see any workaround
async function parseAstClosure(): Promise<(script: string) => string> {
    let cfg = new HostImportsConfig((cfg) => newLogImport(cfg));
    let instance = await interpreterInstance(cfg);

    return (script: string) => {
        return aqua.ast(instance.exports, script);
    };
}

/// Parses script and returns AST in JSON format
/// NOTE & TODO: interpreter is instantiated every time, make it a lazy constant?
async function parseAIR(script: string): Promise<string> {
    let closure = await parseAstClosure();
    return closure(script);
}

export class AquamarineInterpreter {
    private wasmWrapper;

    constructor(wasmWrapper) {
        this.wasmWrapper = wasmWrapper;
    }

    static async create(config: { particleHandler: ParticleHandler; peerId: PeerId }) {
        const cfg = new HostImportsConfig((cfg) => {
            return newImportObject(config.particleHandler, cfg, config.peerId);
        });

        const instance = await interpreterInstance(cfg);
        const res = new AquamarineInterpreter(instance);
        return res;
    }

    invoke(init_peer_id: string, script: string, prev_data: Uint8Array, data: Uint8Array): string {
        let logLevel = log.getLevel();
        let logLevelStr = 'info';
        if (logLevel === 0) {
            logLevelStr = 'trace';
        } else if (logLevel === 1) {
            logLevelStr = 'debug';
        } else if (logLevel === 2) {
            logLevelStr = 'info';
        } else if (logLevel === 3) {
            logLevelStr = 'warn';
        } else if (logLevel === 4) {
            logLevelStr = 'error';
        } else if (logLevel === 5) {
            logLevelStr = 'off';
        }

        return aqua.invoke(this.wasmWrapper.exports, init_peer_id, script, prev_data, data, logLevelStr);
    }

    parseAir(script: string): string {
        return aqua.ast(this.wasmWrapper.exports, script);
    }
}