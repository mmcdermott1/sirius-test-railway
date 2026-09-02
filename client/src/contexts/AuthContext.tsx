import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { User } from '@/lib/user-types';
import {
  DEFAULT_TIMEZONE_POLICY,
  getRuntimeTimeZone,
  resolveEffectiveTimeZone,
} from '@shared/utils/timezone';

let _clerkSignOut: ((opts?: { redirectUrl?: string }) => Promise<void>) | null = null;
export function registerClerkSignOut(fn: typeof _clerkSignOut) {
  _clerkSignOut = fn;
}

interface MasqueradeInfo {
  isMasquerading: boolean;
  originalUser?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

/**
 * The two facts published by the server that decide which zone this person
 * sees dates in. The third input — the browser's own zone — is read locally.
 */
interface TimeZoneInfo {
  /** The zone the server runs in: what every stored timestamp actually means. */
  systemTimeZone: string;
  /** This person's own recorded zone, or null when they have not chosen one. */
  userTimeZone: string | null;
  /** Whether site policy honours a personal zone at all. */
  allowUserTimezones: boolean;
}

interface AuthContextType {
  user: User | null;
  permissions: string[];
  components: string[];
  masquerade: MasqueradeInfo;
  /** Raw inputs, as published by the server. */
  timezone: TimeZoneInfo;
  /**
   * The zone dates should be displayed in, already resolved. Read this rather
   * than re-deciding from the parts — the resolution rule lives in exactly one
   * place (resolveEffectiveTimeZone) so the server and client cannot disagree.
   */
  displayTimeZone: string;
  login: () => void;
  logout: () => void;
  stopMasquerade: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  authReady: boolean; // True when auth state has been definitively resolved
  hasPermission: (permission: string) => boolean;
  hasComponent: (componentId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [masquerade, setMasquerade] = useState<MasqueradeInfo>({ isMasquerading: false });
  // Seeded with the browser's own zone and the permissive default, which is
  // exactly what people see before this ships. A screen that paints before
  // /api/auth/user answers therefore renders the same dates it renders after,
  // instead of flashing UTC.
  const [timezone, setTimezone] = useState<TimeZoneInfo>(() => ({
    systemTimeZone: getRuntimeTimeZone(),
    userTimeZone: null,
    allowUserTimezones: DEFAULT_TIMEZONE_POLICY.allowUserTimezones,
  }));

  // Check if user is authenticated on app start
  const { data: authData, isLoading } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    queryFn: async () => {
      try {
        const response = await fetch('/api/auth/user', {
          credentials: 'include',
        });
        if (response.status === 401) {
          return null; // Not authenticated
        }
        if (!response.ok) {
          throw new Error('Failed to fetch user data');
        }
        return await response.json();
      } catch (error) {
        return null;
      }
    },
  });

  useEffect(() => {
    if (authData && (authData as any).user) {
      setUser((authData as any).user);
      setPermissions((authData as any).permissions || []);
      setComponents((authData as any).components || []);
      setMasquerade((authData as any).masquerade || { isMasquerading: false });
      const tz = (authData as any).timezone;
      if (tz) setTimezone(tz as TimeZoneInfo);
    } else {
      setUser(null);
      setPermissions([]);
      setComponents([]);
      setMasquerade({ isMasquerading: false });
      setTimezone({
        systemTimeZone: getRuntimeTimeZone(),
        userTimeZone: null,
        allowUserTimezones: DEFAULT_TIMEZONE_POLICY.allowUserTimezones,
      });
    }
  }, [authData]);

  const login = () => {
    window.location.href = '/api/login';
  };

  const logout = useCallback(async () => {
    if (_clerkSignOut) {
      await _clerkSignOut({ redirectUrl: '/api/logout' });
    } else {
      window.location.href = '/api/logout';
    }
  }, []);

  const stopMasquerade = async () => {
    try {
      const response = await fetch('/api/auth/masquerade/stop', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to stop masquerade');
      }
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/access/policies/staff'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/my-employers'] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.includes('/api/users/') && key.includes('/roles') ||
          key.includes('/api/access/')
        );
      }});
    } catch (error) {
      throw error;
    }
  };

  const hasPermission = (permission: string) => {
    return permissions.includes(permission);
  };

  const hasComponent = (componentId: string) => {
    return components.includes(componentId);
  };

  const authReady = !isLoading; // Auth state is ready when loading is complete

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        components,
        masquerade,
        timezone,
        displayTimeZone: resolveEffectiveTimeZone({
          systemTimeZone: timezone.systemTimeZone,
          userTimeZone: timezone.userTimeZone,
          allowUserTimezones: timezone.allowUserTimezones,
        }),
        login,
        logout,
        stopMasquerade,
        isLoading,
        isAuthenticated: !!user,
        authReady,
        hasPermission,
        hasComponent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}