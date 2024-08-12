export type RootType = 'Query' | 'Mutation';

export interface AuditConfig {
    enabled: boolean | string;
    appName: string;
    entityCode: string;
    kafka: AuditKafkaConfig;
    sources: AuditSourcesConfig[];
}

export interface AuditKafkaConfig {
    brokers: string;
    username: string;
    password: string;
    topic: string;
}

export interface AuditSourcesConfig {
    sourceName: string;
    typeName: RootType;
    fieldName: string;
    eventType: EventTypeCodes;
    externalId: string;
}

export enum EventSource {
    HUMAN = 1,
    API = 2,
    SERVICE = 3,
}

export type EventTypeCodes = 'CREATE' | 'UPDATE' | 'REMOVE';

export enum EventType {
    CREATE = 0,
    UPDATE = 1,
    REMOVE = 2,
}
