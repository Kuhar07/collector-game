import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';

export default function OnlinePage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const history = useHistory();

  useEffect(() => {
    if (loading) return;
    if (user) history.replace('/online/lobby');
    else history.replace('/online/auth');
  }, [user, loading, history]);

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
