import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

export function serializeQueryKey(queryKey: readonly unknown[]): string {
  if (queryKey.length === 1) {
    return queryKey[0] as string;
  }
  
  if (queryKey.length === 2 && typeof queryKey[1] === 'object' && queryKey[1] !== null) {
    const [basePath, params] = queryKey as [string, Record<string, unknown>];
    const filteredParams = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
    
    if (filteredParams.length === 0) {
      return basePath;
    }
    
    const searchParams = new URLSearchParams();
    filteredParams.forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    
    return `${basePath}?${searchParams.toString()}`;
  }
  
  return queryKey.join("/") as string;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = serializeQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
