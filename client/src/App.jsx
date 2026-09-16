// Route map. Guards: RequireAuth (login) and RequirePermission (page access).
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Empty, Loading } from './components/ui.jsx';

import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import MyWorkPage from './pages/MyWorkPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectDetailPage from './pages/ProjectDetailPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import TaskPage from './pages/TaskPage.jsx';
import PlanningPage from './pages/PlanningPage.jsx';
import MachinesPage from './pages/MachinesPage.jsx';
import WorkflowsPage from './pages/WorkflowsPage.jsx';
import WorkflowEditorPage from './pages/WorkflowEditorPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import PeoplePage from './pages/PeoplePage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import AdministrationPage from './pages/AdministrationPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading label="Starting…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function RequirePermission({ perm, children }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(perm)) {
    return <Empty icon="alert" title="No access" hint="You do not have permission to view this page." />;
  }
  return children;
}

/** The landing page depends on the role: managers get the dashboard, workers get My Work. */
function HomeRedirect() {
  const { hasPermission, ready } = useAuth();
  if (!ready) return <Loading label="Starting…" />;
  if (hasPermission('projects.view') && hasPermission('reports.view')) return <DashboardPage />;
  if (hasPermission('projects.view') && hasPermission('tasks.edit')) return <DashboardPage />;
  if (hasPermission('tasks.view')) return <Navigate to="/my-tasks" replace />;
  return <Navigate to="/projects" replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={(
          <RequireAuth>
            <Layout />
          </RequireAuth>
        )}
      >
        <Route index path="/" element={<HomeRedirect />} />
        <Route path="/my-tasks" element={<RequirePermission perm="tasks.view"><MyWorkPage /></RequirePermission>} />
        <Route path="/projects" element={<RequirePermission perm="projects.view"><ProjectsPage /></RequirePermission>} />
        <Route path="/projects/:id" element={<RequirePermission perm="projects.view"><ProjectDetailPage /></RequirePermission>} />
        <Route path="/tasks" element={<RequirePermission perm="tasks.view"><TasksPage /></RequirePermission>} />
        <Route path="/tasks/:id" element={<RequirePermission perm="tasks.view"><TaskPage /></RequirePermission>} />
        <Route path="/planning" element={<RequirePermission perm="projects.view"><PlanningPage /></RequirePermission>} />
        <Route path="/machines" element={<RequirePermission perm="projects.view"><MachinesPage /></RequirePermission>} />
        <Route path="/workflows" element={<RequirePermission perm="workflow.view"><WorkflowsPage /></RequirePermission>} />
        <Route path="/workflows/:id" element={<RequirePermission perm="workflow.view"><WorkflowEditorPage /></RequirePermission>} />
        <Route path="/components" element={<RequirePermission perm="components.view"><InventoryPage kind="components" /></RequirePermission>} />
        <Route path="/tools" element={<RequirePermission perm="tools.view"><InventoryPage kind="tools" /></RequirePermission>} />
        <Route path="/people" element={<RequirePermission perm="users.view"><PeoplePage /></RequirePermission>} />
        <Route path="/roles" element={<RequirePermission perm="roles.view"><RolesPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission perm="reports.view"><ReportsPage /></RequirePermission>} />
        <Route path="/approvals" element={<RequirePermission perm="approvals.approve"><ApprovalsPage /></RequirePermission>} />
        <Route path="/notifications" element={<RequirePermission perm="tasks.view"><NotificationsPage /></RequirePermission>} />
        <Route path="/audit" element={<RequirePermission perm="audit_logs.view"><AuditPage /></RequirePermission>} />
        <Route path="/administration" element={<AdministrationPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
