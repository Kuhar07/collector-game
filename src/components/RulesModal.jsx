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
  const rules = t('rules.items');
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
      <IonContent className="ion-padding sk-rules-content">
        <div className="sk-rules-shell">
          <p className="sk-rules-intro">{t('rules.description')}</p>
          <div className="sk-rules-grid">
            {Array.isArray(rules) &&
              rules.map((item, index) => (
                <section key={`${index}-${item.title}`} className="sk-rule-card">
                  <div className="sk-rule-card-title">{item.title}</div>
                  <div className="sk-rule-card-text">{item.text}</div>
                </section>
              ))}
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
}
