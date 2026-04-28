import { IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/react';
import { gameControllerOutline, globeOutline, trophyOutline } from 'ionicons/icons';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';

export default function TabBar() {
  const { t } = useI18n();
  const location = useLocation();

  const isOnTab = (tabRoot) => {
    return location.pathname === tabRoot || location.pathname.startsWith(`${tabRoot}/`);
  };

  const preventSameRouteNav = (e, tabRoot) => {
    if (isOnTab(tabRoot)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <IonTabBar slot="bottom">
      <IonTabButton
        tab="offline"
        href="/offline"
        onClick={(e) => preventSameRouteNav(e, '/offline')}
      >
        <IonIcon icon={gameControllerOutline} />
        <IonLabel>{t('tabs.offline')}</IonLabel>
      </IonTabButton>
      <IonTabButton
        tab="online"
        href="/online"
        onClick={(e) => preventSameRouteNav(e, '/online')}
      >
        <IonIcon icon={globeOutline} />
        <IonLabel>{t('tabs.online')}</IonLabel>
      </IonTabButton>
      <IonTabButton
        tab="leaderboard"
        href="/leaderboard"
        onClick={(e) => preventSameRouteNav(e, '/leaderboard')}
      >
        <IonIcon icon={trophyOutline} />
        <IonLabel>{t('tabs.leaderboard')}</IonLabel>
      </IonTabButton>
    </IonTabBar>
  );
}
