// Theme: VitePress default theme with effect.website-style tokens, fonts and overrides.
// Our CSS is imported after the default theme so its variables win at equal specificity.
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './tokens.css';
import './overrides.css';

const theme: Theme = { extends: DefaultTheme };

export default theme;
