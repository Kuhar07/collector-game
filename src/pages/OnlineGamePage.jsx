import { useEffect, useState, useMemo } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonAlert,
  IonSpinner
} from '@ionic/react';
import { homeOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineGame } from '../hooks/useOnlineGame';
import { useGameTimer } from '../hooks/useGameTimer';
import { formatDelta } from '../game/gameEngine';
import { notifyGameJoin } from '../services/firebaseActions';

export default function OnlineGamePage() {
  const { t, lang } = useI18n();
  const { id } = useParams();
  const { user } = useAuth();
  const history = useHistory();
  const {
    data,
    exists,
    state,
    history: placementHistory,
    scores,
    myPlayerNumber,
    ratings,
    placeDot,
    onTimeout,
    leaveGame,
    turnKey,
    localError,
    finalResult
  } = useOnlineGame(id);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [alertError, setAlertError] = useState('');
  const [opponentLeftOpen, setOpponentLeftOpen] = useState(false);

  useEffect(() => {
    if (exists === false) history.replace('/online/lobby');
    // If user is not a player in this game, go back to lobby
    if (exists === true && data && myPlayerNumber === null) {
      history.replace('/online/lobby');
    }
  }, [exists, history, data, myPlayerNumber]);

  // Notify backend when player joins the game
  useEffect(() => {
    if (!user || !exists || !id) return;
    const notifyJoin = async () => {
      try {
        await notifyGameJoin({ gameId: id });
      } catch (error) {
        console.error('Failed to notify game join:', error);
      }
    };
    notifyJoin();
  }, [user, exists, id]);

  useEffect(() => {
    if (!data) return;
    const opponentLeft =
      data.status === 'left' &&
      data.leftBy &&
      myPlayerNumber != null &&
      data.leftBy !== (myPlayerNumber === 1 ? data.player1uid : data.player2uid);

    if (opponentLeft) {
      const key =
        data.mode === 'ranked'
          ? 'notifications.opponent_left_no_rating_change'
          : 'notifications.opponent_left';
      setAlertError(t(key));
      setOpponentLeftOpen(true);
    }
  }, [data, t, myPlayerNumber]);

  useEffect(() => {
    if (localError) setAlertError(t(localError));
  }, [localError, t]);

  const isMyTurn =
    data?.status === 'active' && data.currentPlayer === myPlayerNumber;

  const seconds = useGameTimer({
    enabled: !!data && data.status === 'active' && !!data.timerEnabled,
    turnKey,
    onTimeout
  });

  const handleMainMenu = async () => {
    await leaveGame();
    history.replace('/online/lobby');
  };

  const message = useMemo(() => {
    if (!finalResult || !data) return '';
    const { winner, score1, score2, timeout, loser, delta1, delta2, newR1, newR2 } =
      finalResult;
    const p1 = data.player1name;
    const p2 = data.player2name;
    const ratingLine =
      delta1 != null && delta2 != null
        ? '\n' +
        t('game.rating_change', {
          p1,
          d1: formatDelta(delta1),
          r1: newR1,
          p2,
          d2: formatDelta(delta2),
          r2: newR2
        })
        : '';
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        t('game.timeout_loss', { player: loserName }) +
        '\n' +
        t('game.game_over_winner', { player: winnerName }) +
        ratingLine
      );
    }
    if (winner === 0) return t('game.game_over_draw') + ratingLine;
    const winnerName = winner === 1 ? p1 : p2;
    return t('game.game_over_winner', { player: winnerName }) + ratingLine;
  }, [finalResult, data, t]);

  if (!data) {
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

  const currentName =
    data.currentPlayer === 1 ? data.player1name : data.player2name;
  const statusText =
    data.phase === 'place'
      ? t('game.phase_place', { player: currentName })
      : t('game.phase_eliminate', { player: currentName });
  const statusColor = data.currentPlayer === 1 ? '#dc3545' : '#007bff';
  const isRanked = data.mode === 'ranked';
  const menuButtonLabel = lang === 'hr' ? 'Izbornik' : t('game.back_to_menu_button');

  return (
    <IonPage>
      <AppHeader title={t('app_title')} />
      <IonContent fullscreen scrollY={false} className="sk-game-content">
        <div className="sk-tab-section sk-game-stage ion-padding-horizontal">
          <div className="sk-game-header">
            <div className={`sk-player-info${data.currentPlayer === 1 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#dc3545' }}>
                {data.player1name}
                {isRanked ? ` (${Math.round(ratings[1])})` : ''}
              </div>
              <div className="sk-player-score">{scores[1]}</div>
            </div>
            <div className="sk-status sk-status-desktop" style={{ color: statusColor }}>
              {data.status === 'active' ? statusText : ''}
            </div>
            <div className={`sk-player-info${data.currentPlayer === 2 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#007bff' }}>
                {data.player2name || '—'}
                {isRanked ? ` (${Math.round(ratings[2])})` : ''}
              </div>
              <div className="sk-player-score">{scores[2]}</div>
            </div>
          </div>

          {data.timerEnabled && data.status === 'active' && (
            <div className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}>
              {seconds}
            </div>
          )}

          <GameBoard
            state={state}
            size={data.gridSize}
            history={placementHistory}
            onCellClick={placeDot}
            disabled={!isMyTurn || data.status !== 'active'}
          />

          <div className="sk-game-controls">
            <IonButton
              className="sk-game-btn sk-game-btn-menu"
              onClick={() => setLeaveOpen(true)}
              fill="solid"
            >
              <IonIcon slot="start" icon={homeOutline} />
              {menuButtonLabel}
            </IonButton>
          </div>

          <div className="sk-status sk-status-mobile" style={{ color: statusColor }}>
            {data.status === 'active' ? statusText : ''}
          </div>
        </div>

        <IonAlert
          isOpen={leaveOpen}
          onDidDismiss={() => setLeaveOpen(false)}
          header={t('game.back_to_menu_button')}
          message={t('game.confirm_reset_message')}
          buttons={[
            { text: t('game.no_button'), role: 'cancel' },
            { text: t('game.yes_button'), handler: handleMainMenu }
          ]}
        />

        <IonAlert
          isOpen={!!alertError && !opponentLeftOpen}
          onDidDismiss={() => {
            setAlertError('');
          }}
          header={t('app_title')}
          message={alertError}
          buttons={[t('notifications.ok_button')]}
        />

        <IonAlert
          isOpen={opponentLeftOpen}
          backdropDismiss={false}
          onDidDismiss={() => {
            setOpponentLeftOpen(false);
            setAlertError('');
          }}
          header={t('app_title')}
          message={alertError}
          buttons={[
            {
              text: t('notifications.ok_button'),
              handler: () => {
                history.replace('/online/lobby');
              }
            }
          ]}
        />

        <IonAlert
          cssClass="sk-alert-pre"
          isOpen={!!finalResult}
          backdropDismiss={false}
          header={t('game.game_over_title')}
          message={message}
          buttons={[
            {
              text: t('game.main_menu_button'),
              handler: handleMainMenu
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
