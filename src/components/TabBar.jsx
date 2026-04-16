import { IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/react';
import { gameControllerOutline, globeOutline, trophyOutline } from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';

export default function TabBar() {
  const { t } = useI18n();
  return (
    <IonTabBar slot="bottom">
      <IonTabButton tab="offline" href="/offline">
        <IonIcon icon={gameControllerOutline} />
        <IonLabel>{t('tabs.offline')}</IonLabel>
      </IonTabButton>
      <IonTabButton tab="online" href="/online">
        <IonIcon icon={globeOutline} />
        <IonLabel>{t('tabs.online')}</IonLabel>
      </IonTabButton>
      <IonTabButton tab="leaderboard" href="/leaderboard">
        <IonIcon icon={trophyOutline} />
        <IonLabel>{t('tabs.leaderboard')}</IonLabel>
      </IonTabButton>
    </IonTabBar>
  );
}
