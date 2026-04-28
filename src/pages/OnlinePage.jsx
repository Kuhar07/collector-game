import { Redirect } from 'react-router-dom';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';

export default function OnlinePage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();

  if (!loading) {
    return <Redirect to={user ? '/online/lobby' : '/online/auth'} />;
  }

  return (
    <IonPage>
      <AppHeader title={t('app_title')} />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <IonSpinner />
        </div>
      </IonContent>
    </IonPage>
  );
}
