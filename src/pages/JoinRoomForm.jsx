import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonInput
} from '@ionic/react';
import { enterOutline, arrowBackOutline } from 'ionicons/icons';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { db } from '../firebase';

export default function JoinRoomForm() {
  const { t } = useI18n();
  const { user } = useAuth();
  const history = useHistory();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    const clean = code.toUpperCase().trim();
    if (!clean) {
      setError(t('notifications.enter_code'));
      return;
    }
    if (!user) {
      history.replace('/online/auth');
      return;
    }
    setError('');
    setJoining(true);
    const gameId = 'game_' + clean;
    try {
      const snap = await getDoc(doc(db, 'games', gameId));
      if (!snap.exists() || snap.data().status !== 'waiting') {
        setError(t('notifications.room_not_found'));
        return;
      }
      await updateDoc(doc(db, 'games', gameId), {
        player2uid: user.uid,
        player2name: user.displayName || user.email,
        status: 'active'
      });
      history.replace(`/online/game/${gameId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title={t('app_title')} />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div className="sk-lobby-panel">
            <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>
              {t('lobby.join_room')}
            </div>
            <IonItem>
              <IonLabel position="stacked">{t('lobby.room_code')}</IonLabel>
              <IonInput
                value={code}
                placeholder={t('lobby.room_code_input_placeholder')}
                maxlength={6}
                onIonInput={(e) => setCode((e.detail.value || '').toUpperCase())}
              />
            </IonItem>
            {error && (
              <p style={{ color: '#dc3545', margin: '12px 0 0' }}>{error}</p>
            )}
            <div className="sk-row-buttons">
              <IonButton disabled={joining} onClick={handleJoin}>
                <IonIcon slot="start" icon={enterOutline} />
                {t('lobby.join_button')}
              </IonButton>
              <IonButton fill="outline" onClick={() => history.replace('/online/lobby')}>
                <IonIcon slot="start" icon={arrowBackOutline} />
                {t('lobby.cancel_button')}
              </IonButton>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
