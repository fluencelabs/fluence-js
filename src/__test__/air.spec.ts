import 'mocha';
import { build } from '../internal/particle';
import { FluenceClient, generatePeerId } from '..';
import { expect } from 'chai';
import { SecurityTetraplet } from '../internal/commonTypes';

const local = async () => {
    const peerId = await generatePeerId();
    const client = new FluenceClient(peerId);
    await client.local();
    return client;
};

describe('== AIR suite', () => {
    it('check init_peer_id', async function () {
        let serviceId = 'init_peer';
        let fnName = 'id';

        let client = await local();

        let res;
        client.registerCallback(serviceId, fnName, (args, _) => {
            res = args[0];
            return res;
        });

        let script = `(call %init_peer_id% ("${serviceId}" "${fnName}") [%init_peer_id%])`;

        await client.sendScript(script);

        expect(res).to.be.equal(client.selfPeerId.toB58String());
    });

    // it('call local function', async function () {
    //     const registry = new ServiceRegistry();
    //     let serviceId = 'console';
    //     let fnName = 'log';
    //     let checkPromise = registerPromiseService(registry, serviceId, fnName, (args) => args[0]);

    //     let client = await Fluence.local(undefined, registry);

    //     let arg = 'hello';
    //     let script = `(call %init_peer_id% ("${serviceId}" "${fnName}") ["${arg}"])`;

    //     // Wrap script into particle, so it can be executed by local WASM runtime
    //     let particle = await build(registry, client.selfPeerId, script, new Map());

    //     await client.executeParticle(particle);

    //     let [args, tetraplets] = await checkPromise;
    //     expect(args).to.be.equal(arg);
    // });

    // it('check particle arguments', async function () {
    //     const registry = new ServiceRegistry();
    //     let serviceId = 'check';
    //     let fnName = 'args';
    //     let checkPromise = registerPromiseService(registry, serviceId, fnName, (args) => args[0]);

    //     let client = await Fluence.local(undefined, registry);

    //     let arg = 'arg1';
    //     let value = 'hello';
    //     let script = `(call %init_peer_id% ("${serviceId}" "${fnName}") [${arg}])`;

    //     let data = new Map();
    //     data.set('arg1', value);
    //     let particle = await build(registry, client.selfPeerId, script, data);

    //     await client.executeParticle(particle);

    //     let [args, tetraplets] = await checkPromise;
    //     expect(args).to.be.equal(value);
    // });

    // it('check security tetraplet', async function () {
    //     const registry = new ServiceRegistry();

    //     let makeDataPromise = registerPromiseService(registry, 'make_data_service', 'make_data', (args) => {
    //         field: 42;
    //     });
    //     let getDataPromise = registerPromiseService(registry, 'get_data_service', 'get_data', (args) => args[0]);

    //     let client = await Fluence.local(undefined, registry);

    //     let script = `
    //     (seq
    //         (call %init_peer_id% ("make_data_service" "make_data") [] result)
    //         (call %init_peer_id% ("get_data_service" "get_data") [result.$.field])
    //     )`;

    //     let particle = await build(registry, client.selfPeerId, script, new Map());

    //     await client.executeParticle(particle);

    //     await makeDataPromise;
    //     let [args, tetraplets] = await getDataPromise;
    //     let tetraplet = tetraplets[0][0];

    //     expect(tetraplet).to.contain({
    //         service_id: 'make_data_service',
    //         function_name: 'make_data',
    //         json_path: '$.field',
    //     });
    // });

    // it('check chain of services work properly', async function () {
    //     const registry = new ServiceRegistry();

    //     this.timeout(5000);
    //     let serviceId1 = 'check1';
    //     let fnName1 = 'fn1';
    //     let checkPromise1 = registerPromiseService(registry, serviceId1, fnName1, (args) => args[0]);

    //     let serviceId2 = 'check2';
    //     let fnName2 = 'fn2';
    //     let checkPromise2 = registerPromiseService(registry, serviceId2, fnName2, (args) => args[0]);

    //     let serviceId3 = 'check3';
    //     let fnName3 = 'fn3';
    //     let checkPromise3 = registerPromiseService(registry, serviceId3, fnName3, (args) => args);

    //     let client = await Fluence.local(undefined, registry);

    //     let arg1 = 'arg1';
    //     let arg2 = 'arg2';

    //     // language=Clojure
    //     let script = `(seq
    //                    (seq
    //                     (call %init_peer_id% ("${serviceId1}" "${fnName1}") ["${arg1}"] result1)
    //                     (call %init_peer_id% ("${serviceId2}" "${fnName2}") ["${arg2}"] result2))
    //                    (call %init_peer_id% ("${serviceId3}" "${fnName3}") [result1 result2]))
    //     `;

    //     let particle = await build(registry, client.selfPeerId, script, new Map());

    //     await client.executeParticle(particle);

    //     let args1 = (await checkPromise1)[0];
    //     expect(args1).to.be.equal(arg1);

    //     let args2 = (await checkPromise2)[0];
    //     expect(args2).to.be.equal(arg2);

    //     let args3 = (await checkPromise3)[0];
    //     expect(args3).to.be.deep.equal([{ result: arg1 }, { result: arg2 }]);
    // });
});
