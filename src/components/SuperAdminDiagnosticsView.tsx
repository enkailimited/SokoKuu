import type { Locale } from '../data/i18n';
import { SuperAdminDashboardLayout } from './SuperAdminDashboardLayout';

export function SuperAdminDiagnosticsView({
  locale = 'en',
  authority,
  mobileSidebarOpen,
  onMobileSidebarOpenChange,
}: {
  locale?: Locale;
  authority: string;
  mobileSidebarOpen?: boolean;
  onMobileSidebarOpenChange?: (open: boolean) => void;
}) {
  return (
    <SuperAdminDashboardLayout
      locale={locale}
      authority={authority}
      mobileSidebarOpen={mobileSidebarOpen}
      onMobileSidebarOpenChange={onMobileSidebarOpenChange}
    />
  );
}

