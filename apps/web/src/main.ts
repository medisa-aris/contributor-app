import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { createAppI18n } from './i18n';
import { onUnauthorized } from './api/http';
import { useAuthStore } from './stores/auth.store';
import { useNavigationStore } from './stores/navigation.store';
import { useThemeStore } from './stores/theme.store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/admin.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
useThemeStore(pinia);
app.use(router);
app.use(createAppI18n());

onUnauthorized(() => {
  const auth = useAuthStore(pinia);
  const navigation = useNavigationStore(pinia);
  const wasAuthenticated = auth.authenticated;
  auth.clear();
  navigation.reset();
  const current = router.currentRoute.value;
  if (wasAuthenticated && current.meta.public !== true) {
    void router.push({ name: 'login', query: { redirect: current.fullPath } });
  }
});

app.mount('#app');
