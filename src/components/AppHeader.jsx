import { useRef, useState } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/react';
import {
  ellipsisVerticalOutline,
  languageOutline,
  moonOutline,
  sunnyOutline
} from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import AppMenuDropdown from './AppMenuDropdown';
import RulesModal from './RulesModal';

export default function AppHeader({ title }) {
  const { t, lang, toggleLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const popoverTriggerId = useRef(`menu-trigger-${Math.random().toString(36).slice(2, 8)}`);

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
              title={lang === 'en' ? 'HR' : 'EN'}
              aria-label="Toggle language"
            >
              <IonIcon slot="icon-only" icon={languageOutline} />
              <span style={{ marginLeft: 4, fontWeight: 700, fontSize: 12 }}>
                {lang === 'en' ? 'HR' : 'EN'}
              </span>
            </IonButton>
            <IonButton
              onClick={toggleTheme}
              title={isDark ? t('menu.theme_light') : t('menu.theme_dark')}
              aria-label="Toggle theme"
            >
              <IonIcon slot="icon-only" icon={isDark ? sunnyOutline : moonOutline} />
            </IonButton>
            <IonButton
              id={popoverTriggerId.current}
              onClick={() => setMenuOpen(true)}
              title={t('header.dropdown')}
              aria-label="Menu"
            >
              <IonIcon slot="icon-only" icon={ellipsisVerticalOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <AppMenuDropdown
        triggerId={popoverTriggerId.current}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onShowRules={() => {
          setMenuOpen(false);
          setRulesOpen(true);
        }}
      />
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}
