import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { getSystemPrefersDark, loadSavedThemeMode, resolveEffectiveDarkMode } from './lib/theme';

const initialDark = resolveEffectiveDarkMode(loadSavedThemeMode(), getSystemPrefersDark());
document.documentElement.classList.toggle('dark', initialDark);

createRoot(document.getElementById('root')!).render(<App />);

