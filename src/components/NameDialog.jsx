import { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonCheckbox,
  IonIcon
} from '@ionic/react';
import { closeOutline, playOutline } from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';

export default function NameDialog({ open, onCancel, onStart }) {
  const { t } = useI18n();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [size, setSize] = useState(6);
  const [timer, setTimer] = useState(false);
  const [error, setError] = useState('');

  const handleStart = () => {
    const p1t = p1.trim();
    const p2t = p2.trim();
    if (!p1t || !p2t) {
      setError(t('game.enter_both_names'));
      return;
    }
    setError('');
    onStart({ player1Name: p1t, player2Name: p2t, gridSize: size, timerEnabled: timer });
  };

  return (
    <IonModal isOpen={open} onDidDismiss={onCancel}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('game.new_game_dialog')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onCancel} aria-label="Close">
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">{t('game.player1_name')}</IonLabel>
          <IonInput
            value={p1}
            placeholder={t('game.player1_placeholder')}
            onIonInput={(e) => setP1(e.detail.value || '')}
          />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">{t('game.player2_name')}</IonLabel>
          <IonInput
            value={p2}
            placeholder={t('game.player2_placeholder')}
            onIonInput={(e) => setP2(e.detail.value || '')}
          />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">{t('game.grid_size_label')}</IonLabel>
          <IonSelect value={size} onIonChange={(e) => setSize(Number(e.detail.value))}>
            {[4, 6, 8, 10, 12].map((n) => (
              <IonSelectOption key={n} value={n}>
                {n}×{n}
              </IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        <IonItem>
          <IonCheckbox
            checked={timer}
            onIonChange={(e) => setTimer(e.detail.checked)}
            slot="start"
          />
          <IonLabel>{t('game.timer_label')}</IonLabel>
        </IonItem>
        {error && (
          <p style={{ color: '#dc3545', margin: '12px 0 0 16px' }}>{error}</p>
        )}
        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <IonButton onClick={handleStart} color="primary">
            <IonIcon slot="start" icon={playOutline} />
            {t('game.start_button')}
          </IonButton>
          <IonButton onClick={onCancel} fill="outline">
            {t('game.cancel_button')}
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
