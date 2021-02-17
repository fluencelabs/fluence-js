import { FluenceClient } from './FluenceClient';
import { SecurityTetraplet } from './internal/commonTypes';
import Multiaddr from 'multiaddr';
import PeerId, { isPeerId } from 'peer-id';
import { generatePeerId, seedToPeerId } from './internal/peerIdUtils';
import { FluenceClientTmp } from './internal/FluenceClientTmp';
import { RequestFlow } from './internal/RequestFlow';

type Node = {
    peerId: string;
    multiaddr: string;
};

/**
 * Creates a Fluence client. If the `connectTo` is specified connects the client to the network
 * @param { string | Multiaddr | Node } [connectTo] - Node in Fluence network to connect to. If not specified client will not be connected to the n
 * @param { PeerId | string } [peerIdOrSeed] - The Peer Id of the created client. Specified either as PeerId structure or as seed string. Will be generated randomly if not specified
 * @returns { Promise<FluenceClient> } Promise which will be resolved with the created FluenceClient
 */
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

    const client = new FluenceClientTmp(peerId);

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

/**
 * Send a particle to Fluence Network using the specified Fluence Client.
 * @param { FluenceClient } client - The Fluence Client instance.
 * @param { RequestFlow } request  - The particle to send.
 */
export const sendParticle = async (client: FluenceClient, request: RequestFlow): Promise<void> => {
    await client.initiateFlow(request);
};

/**
 * Registers a function which can be called on the client from Aquamarine. The registration is per client basis.
 * @param { FluenceClient } client - The Fluence Client instance.
 * @param { string } serviceId - The identifier of service which would be used to make calls from Aquamarine
 * @param { string } fnName - The identifier of function which would be used to make calls from Aquamarine
 * @param { (args: any[], tetraplets: SecurityTetraplet[][]) => object } handler - The handler which would be called by Aquamarine infrastructure. The result is any object passed back to Aquamarine
 */
export const registerServiceFunction = (
    client: FluenceClient,
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => object,
) => {
    (client as FluenceClientTmp).registerCallback(serviceId, fnName, handler);
};

// prettier-ignore
/**
 * Removes registers for the function previously registered with {@link registerServiceFunction}
 * @param { FluenceClient } client - The Fluence Client instance.
 * @param { string } serviceId - The identifier of service used in {@link registerServiceFunction} call
 * @param { string } fnName - The identifier of function used in {@link registerServiceFunction} call
 */
export const unregisterServiceFunction = (
    client: FluenceClient,
    serviceId: string,
    fnName: string
) => {
    (client as FluenceClientTmp).unregisterCallback(serviceId, fnName);
};

/**
 * Registers an event-like handler for all calls to the specific service\function pair from from Aquamarine. The registration is per client basis. Return a function which when called removes the subscription.
 * Same as registerServiceFunction which immediately returns empty object.
 * @param { FluenceClient } client - The Fluence Client instance.
 * @param { string } serviceId - The identifier of service calls to which from Aquamarine are transformed into events.
 * @param { string } fnName - The identifier of function calls to which from Aquamarine are transformed into events.
 * @param { (args: any[], tetraplets: SecurityTetraplet[][]) => object } handler - The handler which would be called by Aquamarine infrastructure
 * @returns { Function } - A function which when called removes the subscription.
 */
export const subscribeToEvent = (
    client: FluenceClient,
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => void,
): Function => {
    const realHandler = (args: any[], tetraplets: SecurityTetraplet[][]) => {
        // dont' block
        setTimeout(() => {
            handler(args, tetraplets);
        }, 0);

        return {};
    };
    registerServiceFunction(client, serviceId, fnName, realHandler);
    return () => {
        unregisterServiceFunction(client, serviceId, fnName);
    };
};

/**
 * Send a particle with a fetch-like semantics. In order to for this to work you have to you have to make a call to the same callbackServiceId\callbackFnName pair from Air script as specified by the parameters. The arguments of the call are returned as the resolve value of promise
 * @param { FluenceClient } client - The Fluence Client instance.
 * @param { RequestFlow } particle  - The particle to send.
 * @param { string } callbackFnName - The identifier of function which should be used in Air script to pass the data to fetch "promise"
 * @param { [string]='_callback' } callbackServiceId - The service identifier which should be used in Air script to pass the data to fetch "promise"
 * @returns { Promise<T> } - A promise which would be resolved with the data returned from Aquamarine
 */
export const sendParticleAsFetch = async <T>(
    client: FluenceClient,
    particle: RequestFlow,
    callbackFnName: string,
    callbackServiceId: string = '_callback',
): Promise<T> => {
    const serviceId = callbackServiceId;
    const fnName = callbackFnName;

    let promise: Promise<T> = new Promise(function (resolve, reject) {
        const unsub = subscribeToEvent(client, serviceId, fnName, (args: any[], _) => {
            unsub();
            resolve(args as any);
        });

        setTimeout(() => {
            unsub();
            reject(new Error(`callback for ${callbackServiceId}/${callbackFnName} timed out after ${particle.ttl}`));
        }, particle.ttl);
    });

    sendParticle(client, particle);

    return promise;
};
