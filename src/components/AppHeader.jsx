import { useState, useEffect } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/react';
import {
  helpCircleOutline,
  languageOutline,
  moonOutline,
  sunnyOutline
} from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import RulesModal from './RulesModal';

export default function AppHeader({ title }) {
  const { t, lang, toggleLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [rulesOpen, setRulesOpen] = useState(false);

  // Close rules modal when auth state changes (prevents leftover overlays after redirect signin)
  useEffect(() => {
    const handler = () => setRulesOpen(false);
    window.addEventListener('auth-changed', handler);
    return () => window.removeEventListener('auth-changed', handler);
  }, []);

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <span className="sk-header-title">{title || t('app_title')}</span>
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={toggleLang}
              title={lang === 'en' ? 'EN' : 'HR'}
              aria-label="Toggle language"
            >
              <IonIcon slot="icon-only" icon={languageOutline} />
              <span style={{ marginLeft: 4, fontWeight: 700, fontSize: 12 }}>
                {lang === 'en' ? 'EN' : 'HR'}
              </span>
            </IonButton>
            <IonButton
              onClick={toggleTheme}
              title={isDark ? t('menu.theme_light') : t('menu.theme_dark')}
              aria-label="Toggle theme"
            >
              <IonIcon slot="icon-only" icon={isDark ? moonOutline : sunnyOutline} />
            </IonButton>
            <IonButton
              onClick={() => setRulesOpen(true)}
              title={t('rules.title')}
              aria-label="Rules"
            >
              <IonIcon slot="icon-only" icon={helpCircleOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}
