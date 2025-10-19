declare module 'connect-redis' {
  import type { SessionData, Store } from 'express-session';
  import type Redis from 'ioredis';

  export type RedisClient = Redis & {
    scanIterator?(pattern: string, count: number): AsyncIterable<string>;
    mGet?(keys: string[]): Promise<(string | null)[]>;
  };

  export interface Serializer {
    parse(text: string): SessionData | Promise<SessionData>;
    stringify(session: SessionData): string;
  }

  export interface RedisStoreOptions {
    client: RedisClient;
    prefix?: string;
    scanCount?: number;
    serializer?: Serializer;
    ttl?: number | ((session: SessionData) => number);
    disableTTL?: boolean;
    disableTouch?: boolean;
  }

  class RedisStore extends Store {
    constructor(options: RedisStoreOptions);

    get(sid: string, callback: (err?: unknown, session?: SessionData | null) => void): void;

    set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void;

    touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void;

    destroy(sid: string, callback?: (err?: unknown) => void): void;

    clear(callback?: (err?: unknown) => void): void;

    length(callback: (err: unknown, length?: number) => void): void;

    ids(callback: (err: unknown, ids?: string[]) => void): void;

    all(callback: (err: unknown, sessions?: SessionData[]) => void): void;
  }

  export default RedisStore;
}
