import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonCheckbox
} from '@ionic/react';
import {
  gameControllerOutline,
  trophyOutline,
  enterOutline,
  trophySharp,
  addCircleOutline,
  flashOutline,
  logOutOutline
} from 'ionicons/icons';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { db } from '../firebase';

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function LobbyScreen() {
  const { t } = useI18n();
  const { user, loading, signOut } = useAuth();
  const history = useHistory();
  const [mode, setMode] = useState(null); // null | 'casual' | 'ranked'
  const [gridSize, setGridSize] = useState(6);
  const [timer, setTimer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    if (!loading && !user) history.replace('/online/auth');
  }, [user, loading, history]);

  if (!user) return null;

  const handleCreateCasualRoom = async () => {
    const size = gridSize;
    const timerEnabled = timer;
    const code = generateGameCode();
    const gameId = 'game_' + code;

    setCreating(true);
    setError('');
    try {
      await setDoc(doc(db, 'games', gameId), {
        gameCode: code,
        mode: 'casual',
        source: 'room',
        status: 'waiting',
        player1uid: user.uid,
        player1name: user.displayName || user.email,
        player2uid: null,
        player2name: null,
        gridSize: size,
        timerEnabled,
        currentPlayer: 1,
        phase: 'place',
        lastPlaces: null,
        gameStateJSON: null,
        placementHistory: { p1: [], p2: [] },
        timeouts: { p1: 0, p2: 0 },
        result: null,
        createdAt: serverTimestamp()
      });
      history.push(`/online/waiting/${code}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleFindMatch = () => {
    const params =
      mode === 'casual'
        ? `?gridSize=${gridSize}&timer=${timer ? 1 : 0}`
        : '';
    history.push(`/online/matchmaking/${mode}${params}`);
  };

  const handleSignOut = async () => {
    await signOut();
    history.push('/online');
  };

  const handleUserBarClick = () => {
    setShowEmail(!showEmail);
  };

  return (
    <IonPage>
      <AppHeader title={t('app_title')} />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div className="sk-user-bar" title={user.email} onClick={handleUserBarClick}>
            {showEmail ? user.email : (user.displayName || user.email)}
          </div>

          {!mode && (
            <div className="sk-menu-buttons">
              <IonButton
                className="sk-menu-btn"
                expand="block"
                onClick={() => setMode('casual')}
              >
                <IonIcon slot="start" icon={gameControllerOutline} />
                {t('lobby.create_casual')}
              </IonButton>
              <IonButton
                className="sk-menu-btn"
                expand="block"
                onClick={() => setMode('ranked')}
              >
                <IonIcon slot="start" icon={trophySharp} />
                {t('lobby.create_ranked')}
              </IonButton>
              <IonButton
                className="sk-menu-btn"
                expand="block"
                onClick={() => history.push('/leaderboard')}
              >
                <IonIcon slot="start" icon={trophyOutline} />
                {t('lobby.online_leaderboard')}
              </IonButton>
              <IonButton
                fill="outline"
                expand="block"
                onClick={handleSignOut}
              >
                <IonIcon slot="start" icon={logOutOutline} />
                {t('header.sign_out')}
              </IonButton>
            </div>
          )}

          {mode === 'casual' && (
            <div className="sk-lobby-panel">
              <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>
                {t('lobby.casual_mode')}
              </div>
              <IonItem>
                <IonLabel position="stacked">{t('lobby.grid_size')}</IonLabel>
                <IonSelect
                  value={gridSize}
                  onIonChange={(e) => setGridSize(Number(e.detail.value))}
                >
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
                <IonLabel>{t('lobby.timer_label')}</IonLabel>
              </IonItem>
              {error && (
                <p style={{ color: '#dc3545', marginTop: 12 }}>{error}</p>
              )}
              <div className="sk-row-buttons">
                <IonButton disabled={creating} onClick={handleCreateCasualRoom}>
                  <IonIcon slot="start" icon={addCircleOutline} />
                  {t('lobby.create_button')}
                </IonButton>
                <IonButton onClick={handleFindMatch}>
                  <IonIcon slot="start" icon={flashOutline} />
                  {t('lobby.find_match')}
                </IonButton>
              </div>
              <div className="sk-row-buttons">
                <IonButton fill="outline" onClick={() => history.push('/online/join')}>
                  <IonIcon slot="start" icon={enterOutline} />
                  {t('lobby.join_game')}
                </IonButton>
                <IonButton fill="outline" onClick={() => setMode(null)}>
                  {t('lobby.cancel_button')}
                </IonButton>
              </div>
            </div>
          )}

          {mode === 'ranked' && (
            <div className="sk-lobby-panel">
              <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>
                {t('lobby.ranked_mode')}
              </div>
              <p style={{ textAlign: 'center', marginTop: 0 }}>
                {t('lobby.ranked_matchmaking_only')}
              </p>
              {error && <p style={{ color: '#dc3545', marginTop: 12 }}>{error}</p>}
              <div className="sk-row-buttons">
                <IonButton onClick={handleFindMatch}>
                  <IonIcon slot="start" icon={flashOutline} />
                  {t('lobby.find_match')}
                </IonButton>
                <IonButton fill="outline" onClick={() => setMode(null)}>
                  {t('lobby.cancel_button')}
                </IonButton>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
