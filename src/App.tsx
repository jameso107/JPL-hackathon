import Dashboard from './components/Dashboard';
import PasswordGate from './components/PasswordGate';

export default function App() {
  return (
    <PasswordGate>
      <Dashboard />
    </PasswordGate>
  );
}
