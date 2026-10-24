import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/shared/StateViews";
import { Card } from "@/components/ui/Card";
import { ApiStoreProvider } from "@/lib/apiStore";
import { isApiConfigured } from "@/lib/apiClient";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DemoStoreProvider } from "@/lib/demoStore";
import { AuditPage } from "@/pages/AuditPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { ReturnDetailPage } from "@/pages/ReturnDetailPage";
import { ReturnsPage } from "@/pages/ReturnsPage";
import { SettingsPage } from "@/pages/SettingsPage";

function NotFoundPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          title="That page doesn't exist"
          description="The link may be wrong or the page may have moved."
          action={
            <Link to="/" className="btn-primary">
              Go to dashboard
            </Link>
          }
        />
      </Card>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="returns/:returnId" element={<ReturnDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** Used when a backend URL is configured: login first, then real data. */
function ApiApp() {
  const { user, signOut } = useAuth();
  // Chosen from the login or error screen. It lasts until the page is refreshed.
  const [useDemo, setUseDemo] = useState(false);

  if (useDemo) {
    return (
      <DemoStoreProvider>
        <AppRoutes />
      </DemoStoreProvider>
    );
  }

  if (!user) {
    return <LoginPage onUseDemo={() => setUseDemo(true)} />;
  }

  return (
    <ApiStoreProvider onUseDemo={() => setUseDemo(true)} onSignOut={signOut}>
      <AppRoutes />
    </ApiStoreProvider>
  );
}

export default function App() {
  if (!isApiConfigured) {
    return (
      <DemoStoreProvider>
        <AppRoutes />
      </DemoStoreProvider>
    );
  }

  return (
    <AuthProvider>
      <ApiApp />
    </AuthProvider>
  );
}