/** Which dashboard a dashboard component edits: the page's dashboard or its Board. */
import { createContext, useContext } from 'react';
import type { DashboardSurface } from '../../engine/store';

export const DashboardSurfaceContext = createContext<DashboardSurface>('dashboard');

export function useDashboardSurface(): DashboardSurface {
  return useContext(DashboardSurfaceContext);
}
