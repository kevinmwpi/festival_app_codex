/**
 * Minimal fake of the supabase-js client surface data-access uses. Every query records a
 * `QueryCall` and resolves to whatever the test's handler returns (no `data` for a write without
 * `.select()`, as with PostgREST's `return=minimal`). Like PostgREST, a `range(from, to)`
 * slices an array result, `select(…, { count: 'exact' })` reports the full row count, and
 * `maxRows` (see `createFakeSupabase`) silently caps every array response.
 */
export type QueryOp = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

export interface QueryCall {
  table: string;
  op: QueryOp;
  columns: string | null;
  values: unknown;
  options: Record<string, unknown> | null;
  filters: Array<[string, string, unknown]>;
  single: 'single' | 'maybeSingle' | null;
  returning: string | null;
  range: [number, number] | null;
  count: string | null;
  order: Array<[string, boolean]>;
}

export interface QueryResponse {
  data?: unknown;
  error?: { message: string; code?: string; details?: string | null } | null;
  status?: number;
  /** Exact count to report instead of the length of `data`. */
  count?: number;
}

export type QueryHandler = (call: QueryCall) => QueryResponse | Promise<QueryResponse>;

function createBuilder(table: string, handler: QueryHandler, calls: QueryCall[], limits: { maxRows: number | null }) {
  const call: QueryCall = {
    table,
    op: 'select',
    columns: null,
    values: null,
    options: null,
    filters: [],
    single: null,
    returning: null,
    range: null,
    count: null,
    order: [],
  };
  let opSet = false;

  const builder = {
    select(columns?: string, options?: { count?: string }) {
      if (opSet) {
        call.returning = columns ?? '*';
      } else {
        call.op = 'select';
        call.columns = columns ?? '*';
        opSet = true;
      }
      call.count = options?.count ?? call.count;
      return builder;
    },
    insert(values: unknown, options?: Record<string, unknown>) {
      Object.assign(call, { op: 'insert', values, options: options ?? null });
      opSet = true;
      return builder;
    },
    upsert(values: unknown, options?: Record<string, unknown>) {
      Object.assign(call, { op: 'upsert', values, options: options ?? null });
      opSet = true;
      return builder;
    },
    update(values: unknown) {
      Object.assign(call, { op: 'update', values });
      opSet = true;
      return builder;
    },
    delete() {
      call.op = 'delete';
      opSet = true;
      return builder;
    },
    eq(column: string, value: unknown) {
      call.filters.push(['eq', column, value]);
      return builder;
    },
    in(column: string, value: unknown) {
      call.filters.push(['in', column, value]);
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      call.order.push([column, options?.ascending ?? true]);
      return builder;
    },
    range(from: number, to: number) {
      call.range = [from, to];
      return builder;
    },
    single() {
      call.single = 'single';
      return builder;
    },
    maybeSingle() {
      call.single = 'maybeSingle';
      return builder;
    },
    then<TResult1, TResult2 = never>(
      onfulfilled?: (value: { data: unknown; error: unknown; status: number }) => TResult1 | PromiseLike<TResult1>,
      onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
    ) {
      calls.push(call);
      return Promise.resolve(handler(call))
        .then((response) => {
          // Like PostgREST with `return=minimal`, a write without `.select()` never returns a body.
          const minimalWrite = call.op !== 'select' && call.returning === null;
          let data = minimalWrite ? null : (response.data ?? null);
          let count: number | null = null;
          if (Array.isArray(data) && !response.error) {
            count = call.count ? (response.count ?? data.length) : null;
            const from = call.range ? call.range[0] : 0;
            const to = call.range ? call.range[1] : Number.POSITIVE_INFINITY;
            const limit = Math.min(to - from + 1, limits.maxRows ?? Number.POSITIVE_INFINITY);
            data = data.slice(from, from + limit);
          }
          return {
            data,
            error: response.error ?? null,
            status: response.status ?? (response.error ? 400 : 200),
            count,
          };
        })
        .then(onfulfilled, onrejected);
    },
  };

  return builder;
}

export function createFakeSupabase(handler: QueryHandler = () => ({ data: [] }), options: { maxRows?: number | null } = {}) {
  const calls: QueryCall[] = [];
  /** PostgREST `max_rows`: array responses are cut to this many rows (1000 like `supabase/config.toml`). */
  const limits = { maxRows: options.maxRows === undefined ? 1000 : options.maxRows };
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  let rpcHandler: (name: string, args: unknown) => QueryResponse | Promise<QueryResponse> = () => ({ data: null });

  const client = {
    calls,
    rpcCalls,
    setQueryHandler(next: QueryHandler) {
      handler = next;
    },
    setRpcHandler(next: typeof rpcHandler) {
      rpcHandler = next;
    },
    setMaxRows(maxRows: number | null) {
      limits.maxRows = maxRows;
    },
    from(table: string) {
      return createBuilder(table, (call) => handler(call), calls, limits);
    },
    async rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      const response = await rpcHandler(name, args);
      return { data: response.data ?? null, error: response.error ?? null, status: response.status ?? (response.error ? 400 : 200) };
    },
    auth: {
      signInWithOtp: async (_args: unknown): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null }),
      verifyOtp: async (_args: unknown): Promise<{ data: { session: unknown; user: unknown }; error: unknown }> => ({
        data: { session: null, user: null },
        error: null,
      }),
      signOut: async (_args?: unknown): Promise<{ error: unknown }> => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      startAutoRefresh: async () => undefined,
      stopAutoRefresh: async () => undefined,
    },
    functions: {
      invoke: async (_name: string, _options?: unknown): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }),
    },
    storage: {
      from: (_bucket: string) => ({
        upload: async (_path: string, _body: unknown, _options?: unknown) => ({ data: { path: _path }, error: null as unknown }),
        remove: async (_paths: string[]) => ({ data: [], error: null as unknown }),
        createSignedUrl: async (path: string, _ttl: number) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null as unknown }),
      }),
    },
  };

  return client;
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
