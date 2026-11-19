import type { Locale } from '../data/i18n';
import type { FocusOrderTarget } from '../lib/sokoFocusOrder';
import { SuperAdminDashboardLayout } from './SuperAdminDashboardLayout';

export function SuperAdminDiagnosticsView({
  locale = 'en',
  authority,
  mobileSidebarOpen,
  onMobileSidebarOpenChange,
  focusOrder,
}: {
  locale?: Locale;
  authority: string;
  mobileSidebarOpen?: boolean;
  onMobileSidebarOpenChange?: (open: boolean) => void;
  focusOrder?: FocusOrderTarget | null;
}) {
  return (
    <SuperAdminDashboardLayout
      locale={locale}
      authority={authority}
      mobileSidebarOpen={mobileSidebarOpen}
      onMobileSidebarOpenChange={onMobileSidebarOpenChange}
      focusOrder={focusOrder}
    />
  );
}

