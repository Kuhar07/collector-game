import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonButton, IonIcon } from '@ionic/react';
import { addCircleOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import NameDialog from '../components/NameDialog';
import { useI18n } from '../contexts/I18nContext';
import { useLocalGame } from '../contexts/LocalGameContext';

export default function OfflinePage() {
  const { t } = useI18n();
  const { startGame } = useLocalGame();
  const history = useHistory();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleStart = (config) => {
    startGame(config);
    setDialogOpen(false);
    history.push('/offline/game');
  };

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div className="sk-logo">{t('app_title')}</div>
          <div className="sk-menu-buttons">
            <IonButton
              className="sk-menu-btn"
              expand="block"
              onClick={() => setDialogOpen(true)}
            >
              <IonIcon slot="start" icon={addCircleOutline} />
              {t('menu.new_game')}
            </IonButton>
          </div>
        </div>
        <NameDialog
          open={dialogOpen}
          onCancel={() => setDialogOpen(false)}
          onStart={handleStart}
        />
      </IonContent>
    </IonPage>
  );
}
