import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/chrome.css';
import './styles/sheets.css';

import { App } from './app';

const app = new App(document.getElementById('app')!);
if (import.meta.env.DEV) Object.assign(window, { app });
