import { useEffect } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonSpinner
} from '@ionic/react';
import { closeCircleOutline } from 'ionicons/icons';
import { doc, updateDoc } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { useFirestoreGame } from '../hooks/useFirestoreGame';
import { db } from '../firebase';

export default function WaitingRoom() {
  const { t } = useI18n();
  const { code } = useParams();
  const history = useHistory();
  const gameId = 'game_' + code;
  const { data, exists } = useFirestoreGame(gameId);

  useEffect(() => {
    if (!data) return;
    if (data.status === 'active') history.replace(`/online/game/${gameId}`);
    if (data.status === 'cancelled') history.replace('/online/lobby');
  }, [data, history, gameId]);

  useEffect(() => {
    if (exists === false) history.replace('/online/lobby');
  }, [exists, history]);

  const cancel = async () => {
    try {
      await updateDoc(doc(db, 'games', gameId), { status: 'cancelled' });
    } catch (_) {}
    history.replace('/online/lobby');
  };

  return (
    <IonPage>
      <AppHeader title={t('app_title')} />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div className="sk-lobby-panel">
            <p style={{ textAlign: 'center', marginTop: 0 }}>
              {t('lobby.waiting_room')}
            </p>
            <p className="sk-room-code">{code}</p>
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <IonSpinner />
            </div>
            <div className="sk-row-buttons">
              <IonButton fill="outline" color="medium" onClick={cancel}>
                <IonIcon slot="start" icon={closeCircleOutline} />
                {t('lobby.cancel_button')}
              </IonButton>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
