import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonButton, IonIcon } from '@ionic/react';
import { logoGoogle, arrowBackOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';

export default function AuthScreen() {
  const { t } = useI18n();
  const { user, signIn, error } = useAuth();
  const history = useHistory();

  useEffect(() => {
    if (user) history.replace('/online/lobby');
  }, [user, history]);

  return (
    <IonPage>
      <AppHeader title={t('auth.title')} />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div className="sk-logo">{t('app_title')}</div>
          <p style={{ marginBottom: 20 }}>{t('auth.message')}</p>
          <div className="sk-menu-buttons">
            <IonButton className="sk-menu-btn" expand="block" onClick={signIn}>
              <IonIcon slot="start" icon={logoGoogle} />
              {t('auth.sign_in_google')}
            </IonButton>
            <IonButton
              fill="outline"
              expand="block"
              onClick={() => history.replace('/offline')}
            >
              <IonIcon slot="start" icon={arrowBackOutline} />
              {t('auth.cancel')}
            </IonButton>
          </div>
          {error && (
            <p style={{ color: '#dc3545', marginTop: 16, textAlign: 'center' }}>{error}</p>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
