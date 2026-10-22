import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useRoute } from './router.tsx';
import { QuickTest } from './pages/QuickTest.tsx';
import { Session, PopoutViewer } from './pages/Session.tsx';
import { Projects, ProjectDetail } from './pages/Projects.tsx';
import { Results } from './pages/Results.tsx';
import { Environments } from './pages/Environments.tsx';
import { Settings } from './pages/Settings.tsx';

const NAV = [['', 'Quick test'], ['projects', 'Projects'], ['results', 'Results'], ['browsers', 'Browser environments'], ['settings', 'Settings & help']] as const;

function App() {
  const [page = '', id] = useRoute();
  if (page === 'viewer' && id) return <PopoutViewer id={id} />;
  return (
    <>
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById('content')?.focus(); }}>Skip to content</a>
      <header className="top">
        <a className="brand" href="#/">Browser<span>Lab</span></a>
        <nav className="main" aria-label="Main">
          {NAV.map(([p, label]) => <a key={p} href={`#/${p}`} aria-current={page === p || (p === 'projects' && page === 'project') ? 'page' : undefined}>{label}</a>)}
        </nav>
      </header>
      <div id="content" tabIndex={-1}>
        {page === 'session' && id ? <Session id={id} />
          : page === 'projects' ? <Projects />
          : page === 'project' && id ? <ProjectDetail id={id} />
          : page === 'results' ? <Results />
          : page === 'browsers' ? <Environments />
          : page === 'settings' ? <Settings />
          : <QuickTest />}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
