import DashboardLayoutClient from '@/components/platform/DashboardLayoutClient'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>
}
