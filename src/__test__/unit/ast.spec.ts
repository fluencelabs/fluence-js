import { AirInterpreter } from '@fluencelabs/avm';

describe('== AST parsing suite', () => {
    it('parse simple script and return ast', async function () {
        const interpreter = await AirInterpreter.create(
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
        );
        let ast = interpreter.parseAir(`
            (call "node" ("service" "function") [1 2 3] output)
        `);

        ast = JSON.parse(ast);

        expect(ast).toEqual({
            Call: {
                peer_part: { PeerPk: { Literal: 'node' } },
                function_part: { ServiceIdWithFuncName: [{ Literal: 'service' }, { Literal: 'function' }] },
                args: [
                    {
                        Number: {
                            Int: 1,
                        },
                    },
                    {
                        Number: {
                            Int: 2,
                        },
                    },
                    {
                        Number: {
                            Int: 3,
                        },
                    },
                ],
                output: {
                    Variable: { Scalar: 'output' },
                },
            },
        });
    });
});
