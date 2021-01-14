import { FluenceClient } from './FluenceClient';
import { SecurityTetraplet } from './internal/commonTypes';
import { Particle } from './internal/particle';
import Multiaddr from 'multiaddr';
import PeerId, { isPeerId } from 'peer-id';
import { generatePeerId, seedToPeerId } from './internal/peerIdUtils';

type Node = {
    peerId: string;
    multiaddr: string;
};

export const createClient = async (
    connectTo?: string | Multiaddr | Node,
    peerIdOrSeed?: PeerId | string,
): Promise<FluenceClient> => {
    let peerId;
    if (!peerIdOrSeed) {
        peerId = await generatePeerId();
    } else if (isPeerId(peerIdOrSeed)) {
        // keep unchanged
        peerId = peerIdOrSeed;
    } else {
        // peerId is string, therefore seed
        peerId = await seedToPeerId(peerIdOrSeed);
    }

    const client = new FluenceClient(peerId);

    if (connectTo) {
        let theAddress: Multiaddr;
        let fromNode = (connectTo as any).multiaddr;
        if (fromNode) {
            theAddress = new Multiaddr(fromNode);
        } else {
            theAddress = new Multiaddr(connectTo as string);
        }

        await client.connect(theAddress);
    }

    return client;
};

export const sendParticle = async (client: FluenceClient, particle: Particle): Promise<string> => {
    return await client.sendScript(particle.script, particle.data, particle.ttl);
};

export const registerServiceFunction = (
    client: FluenceClient,
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => object,
) => {
    client.registerCallback(serviceId, fnName, handler);
};

// prettier-ignore
export const unregisterServiceFunction = (
    client: FluenceClient,
    serviceId: string,
    fnName: string
) => {
    client.unregisterCallback(serviceId, fnName);
};

export const subscribeToEvent = (
    client: FluenceClient,
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => void,
): Function => {
    const realHandler = (args: any[], tetraplets: SecurityTetraplet[][]) => {
        // dont' block
        setImmediate(() => {
            handler(args, tetraplets);
        });

        return {};
    };
    registerServiceFunction(client, serviceId, fnName, realHandler);
    return () => {
        unregisterServiceFunction(client, serviceId, fnName);
    };
};

export const sendParticleAsFetch = async <T>(
    client: FluenceClient,
    particle: Particle,
    resultArgNames: string[],
): Promise<T> => {
    return await client.fetch(particle.script, resultArgNames, particle.data, particle.ttl);
};