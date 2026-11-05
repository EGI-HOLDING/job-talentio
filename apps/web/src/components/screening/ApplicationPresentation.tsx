'use client';
import { createContext, useContext, useLayoutEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { usePathname } from '@/lib/navigation';

const Presentation = createContext<{ focused: boolean; setKey: Dispatch<SetStateAction<string | null>> }>({ focused: false, setKey: () => undefined });
export function ApplicationPresentationProvider({ children }: { children: ReactNode }) {
    const path = usePathname();
    const [key, setKey] = useState<string | null>(null);
    const value = useMemo(() => ({ focused: key === path && path.startsWith('/apply/'), setKey }), [key, path]);
    return <Presentation.Provider value={value}>{children}</Presentation.Provider>;
}
export function useApplicationPresentation() { return useContext(Presentation); }
export function useScreeningFocus(active: boolean) {
    const path = usePathname(), { setKey } = useApplicationPresentation();
    useLayoutEffect(() => {
        if (!active) return;
        setKey(path);
        return () => setKey(current => current === path ? null : current);
    }, [active, path, setKey]);
}
