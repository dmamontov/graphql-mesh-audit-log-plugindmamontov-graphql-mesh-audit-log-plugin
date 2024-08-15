import { Kafka, type Message } from 'kafkajs';
import lodashGet from 'lodash.get';
import protobuf from 'protobufjs';
import { Md5 } from 'ts-md5';
import { type MeshPlugin, type MeshPluginOptions } from '@graphql-mesh/types';
import { EventSource, EventType, type AuditConfig } from './types';
import { evaluate } from './utils';

export default function useAudit(options: MeshPluginOptions<AuditConfig>): MeshPlugin<any> {
    let { logger, enabled, appName, entityCode, kafka: kafkaConfig, sources } = options;

    if (!evaluate(enabled)) {
        return {};
    }

    kafkaConfig = Object.keys(kafkaConfig).reduce(function (result: any, key) {
        // @ts-expect-error
        result[key] = evaluate(kafkaConfig[key]);

        return result;
    }, {});

    appName = evaluate(appName);
    entityCode = evaluate(entityCode);

    const kafka = new Kafka({
        clientId: appName,
        brokers: kafkaConfig.brokers.split(','),
        sasl: {
            mechanism: 'scram-sha-512',
            username: kafkaConfig.username,
            password: kafkaConfig.password,
        },
    });

    const producer = kafka.producer();

    let protobufMessage: protobuf.Type;

    const loadProto = (): void => {
        // eslint-disable-next-line unicorn/prefer-module
        protobuf.load(__dirname + '/message.proto', (err, root) => {
            if (err) {
                throw err;
            }

            if (!root) {
                return;
            }

            protobufMessage = root.lookupType('message.Message');
        });
    };

    loadProto();

    const toAudit = async (message: object): Promise<void> => {
        if (!protobufMessage) {
            loadProto();
        }

        if (!protobufMessage) {
            return;
        }

        const errMsg = protobufMessage.verify(message);
        if (errMsg) {
            throw new Error(errMsg);
        }

        await producer.connect();

        await producer.send({
            topic: kafkaConfig.topic,
            messages: [
                {
                    key: Md5.hashStr(JSON.stringify(message)),
                    value: protobufMessage.encode(protobufMessage.create(message)).finish(),
                } as Message,
            ],
        });

        await producer.disconnect();
    };

    return {
        onDelegate(payload) {
            const source = sources.find(
                source =>
                    source.sourceName === payload.sourceName &&
                    source.typeName === payload.typeName &&
                    source.fieldName === payload.fieldName,
            );

            if (!source) {
                // @ts-expect-error
                return;
            }

            const startTime = Date.now();

            const userId =
                payload.context?.currentUser?.id ||
                payload.context?.currentUser?.email ||
                payload.context?.currentUser?.name ||
                null;

            const args = payload.key ? payload.argsFromKeys([payload.key]) : payload.args;

            const externalId = source.externalId ? lodashGet(args, source.externalId) : null;

            const message = {
                entity: {
                    code: entityCode,
                },
                event: {
                    source: EventSource.HUMAN,
                    type: source?.eventType
                        ? EventType[source.eventType as keyof typeof EventType]
                        : EventType.CREATE,
                    user: {
                        id: userId,
                    },
                    request: {
                        id: payload.context?.propagator?.traceId,
                    },
                    fields: [
                        {
                            code: 'app_code',
                            value: appName,
                        },
                        {
                            code: 'external_id',
                            value: Array.isArray(externalId)
                                ? JSON.stringify(externalId)
                                : externalId.toString(),
                        },
                        {
                            code: 'source_name',
                            value: payload.sourceName,
                        },
                        {
                            code: 'type_name',
                            value: payload.typeName,
                        },
                        {
                            code: 'field_name',
                            value: payload.fieldName,
                        },
                        {
                            code: 'args',
                            value: JSON.stringify(args),
                        },
                        {
                            code: 'query',
                            value: payload.context?.params?.query?.toString(),
                        },
                        {
                            code: 'operation_name',
                            value: payload.context?.params?.operationName || 'empty',
                        },
                    ],
                },
            };

            return ({ result }) => {
                const endTime = Date.now() - startTime;

                message.event.fields.push({
                    code: 'latency',
                    value: endTime.toString(),
                });

                if (!message.event?.request?.id) {
                    message.event.request.id = payload.context?.propagator?.traceId;
                }

                let isSuccess = !(result instanceof Error);

                message.event.fields.push({
                    code: 'is_success',
                    value: isSuccess ? 'true' : 'false',
                });

                if (isSuccess) {
                    message.event.fields.push({
                        code: 'result',
                        value: JSON.stringify(result || []),
                    });
                } else {
                    message.event.fields.push({
                        code: 'result',
                        value: JSON.stringify({ error: result?.message || result.toString() }),
                    });
                }

                toAudit(message).catch(error => {
                    logger.error(error);
                });
            };
        },
    };
}
