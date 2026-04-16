import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonIcon
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';

export default function RulesModal({ open, onClose }) {
  const { t } = useI18n();
  return (
    <IonModal isOpen={open} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('rules.title')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p style={{ fontSize: 18, lineHeight: 1.6 }}>{t('rules.description')}</p>
      </IonContent>
    </IonModal>
  );
}
