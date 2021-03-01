import { ResultCodes, SecurityTetraplet } from './commonTypes';

interface ParticleContext {
    particleId: string;
    [x: string]: any;
}

interface AquaCall {
    serviceId: string;
    fnName: string;
    args: any[];
    tetraplets: SecurityTetraplet[][];
    particleContext: ParticleContext;
    [x: string]: any;
}

interface AquaResult {
    retCode: ResultCodes;
    result?: any;
    [x: string]: any;
}

export type Middleware = (req: AquaCall, resp: AquaResult, next: Function) => void;

export const fnHandler = (
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => any,
) => {
    return (req: AquaCall, resp: AquaResult, next: Function): void => {
        if (req.fnName === fnName && req.serviceId === serviceId) {
            const res = handler(req.args, req.tetraplets);
            resp.retCode = ResultCodes.success;
            resp.result = res;
        }
        next();
    };
};

export const fnAsEventHandler = (
    serviceId: string,
    fnName: string,
    handler: (args: any[], tetraplets: SecurityTetraplet[][]) => void,
) => {
    return (req: AquaCall, resp: AquaResult, next: Function): void => {
        if (req.fnName === fnName && req.serviceId === serviceId) {
            setTimeout(() => {
                handler(req.args, req.tetraplets);
            }, 0);

            resp.retCode = ResultCodes.success;
            resp.result = {};
        }
        next();
    };
};

export const errorHandler: Middleware = (req: AquaCall, resp: AquaResult, next: Function): void => {
    try {
        next();
    } catch (e) {
        resp.retCode = ResultCodes.exceptionInHandler;
        resp.result = e.toString();
    }
};

type InternalHandler = (req: AquaCall, resp: AquaResult) => void;

export class AquaCallHandler {
    private static defaultHandler(req: AquaCall, resp: AquaResult) {
        resp.retCode = ResultCodes.noServiceFound;
        resp.result = `Error. There is no service: ${req.serviceId}`;
    }

    middlewares: Middleware[] = [];

    use(middleware: Middleware): AquaCallHandler {
        this.middlewares.push(middleware);
        return this;
    }

    unUse(middleware: Middleware): AquaCallHandler {
        const index = this.middlewares.indexOf(middleware);
        if (index !== -1) {
            this.middlewares.splice(index, 1);
        }
        return this;
    }

    combineWith(other: AquaCallHandler): AquaCallHandler {
        this.middlewares = [...this.middlewares, ...other.middlewares];
        return this;
    }

    on(serviceId: string, fnName: string, handler: (args: any[], tetraplets: SecurityTetraplet[][]) => any): Function {
        const mw = fnHandler(serviceId, fnName, handler);
        this.use(mw);
        return () => {
            this.unUse(mw);
        };
    }

    onEvent(
        serviceId: string,
        fnName: string,
        handler: (args: any[], tetraplets: SecurityTetraplet[][]) => void,
    ): Function {
        const mw = fnAsEventHandler(serviceId, fnName, handler);
        this.use(mw);
        return () => {
            this.unUse(mw);
        };
    }

    buildHanlder(): InternalHandler {
        const result = this.middlewares.reduceRight<InternalHandler>(
            (agg, cur) => {
                return (req, resp) => {
                    cur(req, resp, () => agg(req, resp));
                };
            },
            (req, res) => {},
        );

        return result;
    }

    execute(req: AquaCall): AquaResult {
        const res: AquaResult = {
            retCode: ResultCodes.unkownError,
        };
        this.buildHanlder()(req, res);
        return res;
    }
}
