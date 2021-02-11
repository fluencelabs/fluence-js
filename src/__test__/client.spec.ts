import { expect } from 'chai';

import 'mocha';
import { encode } from 'bs58';
import { certificateFromString, certificateToString, issue } from '../internal/trust/certificate';
import { TrustGraph } from '../internal/trust/trust_graph';
import { nodeRootCert } from '../internal/trust/misc';
import { generatePeerId, peerIdToSeed, seedToPeerId } from '../internal/peerIdUtils';
import { FluenceClientImpl } from '../internal/FluenceClientImpl';
import { createConnectedClient } from './util';
import log from 'loglevel';
import { createClient } from '../api';
import Multiaddr from 'multiaddr';
import {
    addBlueprint, addProvider,
    addScript,
    createService,
    getBlueprints, getInterfaces,
    getModules, getProviders,
    removeScript,
    uploadModule
} from '../internal/builtins';
import {dev} from "@fluencelabs/fluence-network-environment";
import {ModuleConfig, Wasi} from "../internal/moduleConfig";

const devNodeAddress = '/dns4/dev.fluence.dev/tcp/19001/wss/p2p/12D3KooWEXNUbCXooUwHrHBbrmjsrpHXoEphPwbjQXEGyzbqKnE9';
const devNodePeerId = '12D3KooWEXNUbCXooUwHrHBbrmjsrpHXoEphPwbjQXEGyzbqKnE9';

describe('Typescript usage suite', () => {
    it('should create private key from seed and back', async function () {
        // prettier-ignore
        let seed = [46, 188, 245, 171, 145, 73, 40, 24, 52, 233, 215, 163, 54, 26, 31, 221, 159, 179, 126, 106, 27, 199, 189, 194, 80, 133, 235, 42, 42, 247, 80, 201];
        let seedStr = encode(seed);
        console.trace('SEED STR: ' + seedStr);
        let pid = await seedToPeerId(seedStr);
        expect(peerIdToSeed(pid)).to.be.equal(seedStr);
    });

    it('should serialize and deserialize certificate correctly', async function () {
        let cert = `11
1111
5566Dn4ZXXbBK5LJdUsE7L3pG9qdAzdPY47adjzkhEx9
3HNXpW2cLdqXzf4jz5EhsGEBFkWzuVdBCyxzJUZu2WPVU7kpzPjatcqvdJMjTtcycVAdaV5qh2fCGphSmw8UMBkr
158981172690500
1589974723504
2EvoZAZaGjKWFVdr36F1jphQ5cW7eK3yM16mqEHwQyr7
4UAJQWzB3nTchBtwARHAhsn7wjdYtqUHojps9xV6JkuLENV8KRiWM3BhQByx5KijumkaNjr7MhHjouLawmiN1A4d
1590061123504
1589974723504`;

        let deser = await certificateFromString(cert);
        let ser = certificateToString(deser);

        expect(ser).to.be.equal(cert);
    });

    // delete `.skip` and run `npm run test` to check service's and certificate's api with Fluence nodes
    it.skip('should perform tests on certs', async function () {
        this.timeout(15000);
        await testCerts();
    });

    describe.skip('should make connection to network', async function () {
        this.timeout(30000);

        const testProcedure = async (client: FluenceClientImpl) => {
            let resMakingPromise = new Promise((resolve) => {
                client.registerCallback('test', 'test', (args, _) => {
                    resolve(args);
                    return {};
                });
            });

            let script = `
                (seq
                    (call "${client.relayPeerId}" ("op" "identity") [])
                    (call "${client.selfPeerId}" ("test" "test") [hello])
                )
            `;

            let data: Map<string, any> = new Map();
            data.set('hello', 'world');

            await client.sendScript(script, data);

            const res = await resMakingPromise;
            return res;
        };

        it('address as string', async function () {
            // arrange
            const addr = devNodeAddress;

            // act
            const client = (await createClient(addr)) as FluenceClientImpl;

            // assert
            const res = await testProcedure(client);
            expect(res).to.deep.equal(['world']);
        });

        it('address as multiaddr', async function () {
            // arrange
            const addr = new Multiaddr(devNodeAddress);

            // act
            const client = (await createClient(addr)) as FluenceClientImpl;

            // assert
            const res = await testProcedure(client);
            expect(res).to.deep.equal(['world']);
        });

        it('address as node', async function () {
            // arrange
            const addr = {
                multiaddr: devNodeAddress,
                peerId: devNodePeerId,
            };

            // act
            const client = (await createClient(addr)) as FluenceClientImpl;

            // assert
            const res = await testProcedure(client);
            expect(res).to.deep.equal(['world']);
        });

        it('peerid as peer id', async function () {
            // arrange
            const addr = devNodeAddress;
            const pid = await generatePeerId();

            // act
            const client = (await createClient(addr, pid)) as FluenceClientImpl;

            // assert
            const res = await testProcedure(client);
            expect(res).to.deep.equal(['world']);
        });

        it('peerid as seed', async function () {
            // arrange
            const addr = devNodeAddress;
            const pid = peerIdToSeed(await generatePeerId());

            // act
            const client = (await createClient(addr, pid)) as FluenceClientImpl;

            // assert
            const res = await testProcedure(client);
            expect(res).to.deep.equal(['world']);
        });
    });

    it.skip('should make a call through the network', async function () {
        this.timeout(30000);
        // arrange
        const client = await createConnectedClient(dev[0].multiaddr);

        client.registerCallback('test', 'test', (args, _) => {
            console.trace('should make a call through the network, called "test" "test" with args', args);
            return {};
        });

        let resMakingPromise = new Promise((resolve) => {
            client.registerCallback('test', 'reverse_args', (args, _) => {
                resolve([...args].reverse());
                return {};
            });
        });

        // act
        let script = `
            (seq
                (call "${client.relayPeerId}" ("op" "identity") [])
                (seq
                    (call "${client.selfPeerId}" ("test" "test") [a b c d] result)
                    (call "${client.selfPeerId}" ("test" "reverse_args") [a b c d])
                )
            )
        `;

        let data: Map<string, any> = new Map();
        data.set('a', 'some a');
        data.set('b', 'some b');
        data.set('c', 'some c');
        data.set('d', 'some d');

        await client.sendScript(script, data);

        // assert
        const res = await resMakingPromise;
        expect(res).to.deep.equal(['some d', 'some c', 'some b', 'some a']);
    });

    it.skip('fireAndForget should work', async function () {
        this.timeout(30000);
        // arrange
        const client = await createConnectedClient(devNodeAddress);

        let resMakingPromise = new Promise((resolve) => {
            client.registerCallback('test', 'reverse_args', (args, _) => {
                resolve([...args].reverse());
                return {};
            });
        });

        // act
        let script = `
        (call "${client.selfPeerId}" ("test" "reverse_args") [a b c d])
        `;

        let data: Map<string, any> = new Map();
        data.set('a', 'some a');
        data.set('b', 'some b');
        data.set('c', 'some c');
        data.set('d', 'some d');

        await client.fireAndForget(script, data);

        // assert
        const res = await resMakingPromise;
        expect(res).to.deep.equal(['some d', 'some c', 'some b', 'some a']);
    });

    it.skip('get_modules', async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let modulesList = await getModules(client);

        expect(modulesList).not.to.be.undefined;
    });

    it.skip('get_interfaces', async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let interfaces = await getInterfaces(client);

        expect(interfaces).not.to.be.undefined;
    });

    it.skip('get_blueprints', async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let bpList = await getBlueprints(client);

        expect(bpList).not.to.be.undefined;
    });

    it("upload_modules", async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        console.log("peerid: " + client.selfPeerId)

        let config: ModuleConfig = {
            name: "test_broken_module",
            mem_pages_count: 100,
            logger_enabled: true,
            wasi: {
                envs: {a: "b"},
                preopened_files: ["a", "b"],
                mapped_dirs: {c: "d"},
            },
            mounted_binaries: {e: "f"}
        }

        let base64 = "MjNy"

        await uploadModule(client, "test_broken_module", base64, config);
    });

    it.skip("add_blueprint", async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let bpId = "some"

        let bpIdReturned = await addBlueprint(client, "test_broken_blueprint", ["test_broken_module"], bpId);

        expect(bpIdReturned).to.be.equal(bpId);
    });

    it.skip("create_service", async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let serviceId = await createService(client, "test_broken_blueprint");

        // TODO there is no error on broken blueprint from a node
        expect(serviceId).not.to.be.undefined;
    });

    it.skip("add_provider", async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[2].multiaddr);

        let key = Math.random().toString(36).substring(7);
        let buf = Buffer.from(key)

        let r = Math.random().toString(36).substring(7);
        await addProvider(client, buf, dev[2].peerId, r);

        let pr = await getProviders(client, buf);
        console.log(pr)
        console.log(r)
        expect(r).to.be.equal(pr[0][0].service_id);
    });

    it.skip('add and remove script', async function () {
        this.timeout(30000);
        const client = await createConnectedClient(dev[3].multiaddr);

        console.log("peerid: " + client.selfPeerId)

        let script = `
            (seq
                (call "${client.relayPeerId}" ("op" "identity") [])
                (call "${client.selfPeerId}" ("test" "test1") ["1" "2" "3"] result)
            )
        `;

        let resMakingPromise = new Promise((resolve) => {
            client.registerCallback('test', 'test1', (args, _) => {
                resolve([...args]);
                return {};
            });
        });

        let scriptId = await addScript(client, script);

        await resMakingPromise.then((args) => {
            console.log("final!")
            expect(args as string[]).to.be.deep.equal(["1", "2", "3"]);
        }).finally(() => {
            removeScript(client, scriptId);
        })

        expect(scriptId).not.to.be.undefined;
    });

    it.skip('fetch should work', async function () {
        this.timeout(30000);
        // arrange
        const client = await createConnectedClient(devNodeAddress);

        // act
        let script = `
        (call "${client.relayPeerId}" ("op" "identify") [] result)
        `;
        const data = new Map();
        data.set('__relay', client.relayPeerId);

        const [res] = await client.fetch(script, ['result'], data);

        // assert
        expect(res.external_addresses).to.be.not.undefined;
    });

    it.skip('two clients should work inside the same time browser', async function () {
        // arrange
        const pid1 = await generatePeerId();
        const client1 = new FluenceClientImpl(pid1);
        await client1.connect(devNodeAddress);

        const pid2 = await generatePeerId();
        const client2 = new FluenceClientImpl(pid2);
        await client2.connect(devNodeAddress);

        let resMakingPromise = new Promise((resolve) => {
            client2.registerCallback('test', 'test', (args, _) => {
                resolve([...args]);
                return {};
            });
        });

        let script = `
            (seq
                (call "${client1.relayPeerId}" ("op" "identity") [])
                (call "${pid2.toB58String()}" ("test" "test") [a b c d])
            )
        `;

        let data: Map<string, any> = new Map();
        data.set('a', 'some a');
        data.set('b', 'some b');
        data.set('c', 'some c');
        data.set('d', 'some d');

        await client1.sendScript(script, data);

        let res = await resMakingPromise;
        expect(res).to.deep.equal(['some a', 'some b', 'some c', 'some d']);
    });

    it.skip('event registration should work', async function () {
        // arrange
        const pid1 = await generatePeerId();
        const client1 = new FluenceClientImpl(pid1);
        await client1.connect(devNodeAddress);

        const pid2 = await generatePeerId();
        const client2 = new FluenceClientImpl(pid2);
        await client2.connect(devNodeAddress);

        client2.registerEvent('event_stream', 'test');
        const resMakingPromise = new Promise((resolve) => {
            client2.subscribe('event_stream', resolve);
        });

        // act
        let script = `
            (call "${pid2.toB58String()}" ("event_stream" "test") [hello])
        `;

        let data: Map<string, any> = new Map();
        data.set('hello', 'world');

        await client1.fireAndForget(script, data);

        // assert
        let res = await resMakingPromise;
        expect(res).to.deep.equal({
            type: 'test',
            args: ['world'],
        });
    });
});

export async function testCerts() {
    const key1 = await generatePeerId();
    const key2 = await generatePeerId();

    // connect to two different nodes
    const cl1 = new FluenceClientImpl(key1);
    const cl2 = new FluenceClientImpl(key2);

    await cl1.connect('/dns4/134.209.186.43/tcp/9003/ws/p2p/12D3KooWBUJifCTgaxAUrcM9JysqCcS4CS8tiYH5hExbdWCAoNwb');
    await cl2.connect('/ip4/134.209.186.43/tcp/9002/ws/p2p/12D3KooWHk9BjDQBUqnavciRPhAYFvqKBe4ZiPPvde7vDaqgn5er');

    let trustGraph1 = new TrustGraph(/* cl1 */);
    let trustGraph2 = new TrustGraph(/* cl2 */);

    let issuedAt = new Date();
    let expiresAt = new Date();
    // certificate expires after one day
    expiresAt.setDate(new Date().getDate() + 1);

    // create root certificate for key1 and extend it with key2
    let rootCert = await nodeRootCert(key1);
    let extended = await issue(key1, key2, rootCert, expiresAt.getTime(), issuedAt.getTime());

    // publish certificates to Fluence network
    await trustGraph1.publishCertificates(key2.toB58String(), [extended]);

    // get certificates from network
    let certs = await trustGraph2.getCertificates(key2.toB58String());

    // root certificate could be different because nodes save trusts with bigger `expiresAt` date and less `issuedAt` date
    expect(certs[0].chain[1].issuedFor.toB58String()).to.be.equal(extended.chain[1].issuedFor.toB58String());
    expect(certs[0].chain[1].signature).to.be.equal(extended.chain[1].signature);
    expect(certs[0].chain[1].expiresAt).to.be.equal(extended.chain[1].expiresAt);
    expect(certs[0].chain[1].issuedAt).to.be.equal(extended.chain[1].issuedAt);

    await cl1.disconnect();
    await cl2.disconnect();
}
