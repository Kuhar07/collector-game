import { useLocation, useHistory } from 'react-router-dom';
import {
  IonPopover,
  IonList,
  IonItem,
  IonIcon,
  IonLabel
} from '@ionic/react';
import {
  bookOutline,
  sunnyOutline,
  moonOutline,
  languageOutline,
  addCircleOutline,
  refreshOutline,
  homeOutline,
  logOutOutline
} from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useLocalGame } from '../contexts/LocalGameContext';

export default function AppMenuDropdown({ triggerId, open, onClose, onShowRules }) {
  const { t, lang, toggleLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const localGame = useLocalGame();
  const history = useHistory();
  const location = useLocation();

  const isOnGamePage =
    location.pathname === '/offline/game' || location.pathname.startsWith('/online/game/');
  const isOnOfflineGame = location.pathname === '/offline/game';
  const isOnOnlineRoute = location.pathname.startsWith('/online');

  const close = () => onClose && onClose();

  const handleRules = () => {
    onShowRules && onShowRules();
  };

  const handleTheme = () => {
    toggleTheme();
    close();
  };

  const handleLang = () => {
    toggleLang();
    close();
  };

  const handleNewGame = () => {
    close();
    localGame.clearGame();
    history.push('/offline');
  };

  const handleReset = () => {
    close();
    if (isOnOfflineGame && localGame.isActive) localGame.resetGame();
  };

  const handleMainMenu = () => {
    close();
    if (isOnOfflineGame) {
      localGame.clearGame();
      history.push('/offline');
    } else if (isOnOnlineRoute) {
      history.push('/online');
    } else {
      history.push('/offline');
    }
  };

  const handleSignOut = async () => {
    close();
    await signOut();
    history.push('/online');
  };

  return (
    <IonPopover
      trigger={triggerId}
      isOpen={open}
      onDidDismiss={close}
      dismissOnSelect
    >
      <IonList>
        <IonItem button detail={false} onClick={handleRules}>
          <IonIcon slot="start" icon={bookOutline} />
          <IonLabel>{t('rules.title')}</IonLabel>
        </IonItem>
        <IonItem button detail={false} onClick={handleTheme}>
          <IonIcon slot="start" icon={isDark ? sunnyOutline : moonOutline} />
          <IonLabel>{isDark ? t('menu.theme_light') : t('menu.theme_dark')}</IonLabel>
        </IonItem>
        <IonItem button detail={false} onClick={handleLang}>
          <IonIcon slot="start" icon={languageOutline} />
          <IonLabel>{lang === 'en' ? t('menu.language_hr') : t('menu.language_en')}</IonLabel>
        </IonItem>

        {isOnGamePage && (
          <>
            <IonItem button detail={false} onClick={handleNewGame}>
              <IonIcon slot="start" icon={addCircleOutline} />
              <IonLabel>{t('menu.new_game')}</IonLabel>
            </IonItem>
            {isOnOfflineGame && (
              <IonItem button detail={false} onClick={handleReset}>
                <IonIcon slot="start" icon={refreshOutline} />
                <IonLabel>{t('menu.reset_game')}</IonLabel>
              </IonItem>
            )}
            <IonItem button detail={false} onClick={handleMainMenu}>
              <IonIcon slot="start" icon={homeOutline} />
              <IonLabel>{t('menu.main_menu')}</IonLabel>
            </IonItem>
          </>
        )}

        {isOnOnlineRoute && user && (
          <IonItem button detail={false} onClick={handleSignOut}>
            <IonIcon slot="start" icon={logOutOutline} />
            <IonLabel>{t('header.sign_out')}</IonLabel>
          </IonItem>
        )}
      </IonList>
    </IonPopover>
  );
}
