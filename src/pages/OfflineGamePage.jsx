import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonAlert,
  IonIcon
} from '@ionic/react';
import { homeOutline, refreshOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import { useI18n } from '../contexts/I18nContext';
import { useLocalGame } from '../contexts/LocalGameContext';
import { useGameTimer } from '../hooks/useGameTimer';
import { useState } from 'react';

export default function OfflineGamePage() {
  const { t, lang } = useI18n();
  const history = useHistory();
  const {
    config,
    state,
    currentPlayer,
    phase,
    history: placementHistory,
    scores,
    result,
    turnKey,
    placeDot,
    resetGame,
    clearGame,
    onTimeout,
    isActive
  } = useLocalGame();
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    if (!config) history.replace('/offline');
  }, [config, history]);

  const seconds = useGameTimer({
    enabled: !!config && !!config.timerEnabled && isActive,
    turnKey,
    onTimeout
  });

  if (!config) return null;

  const resetButtonLabel = lang === 'hr' ? 'Resetiraj' : t('game.reset_button');
  const menuButtonLabel = lang === 'hr' ? 'Izbornik' : t('game.back_to_menu_button');

  const name = currentPlayer === 1 ? config.player1Name : config.player2Name;
  const statusText =
    phase === 'place'
      ? t('game.phase_place', { player: name })
      : t('game.phase_eliminate', { player: name });
  const statusColor = currentPlayer === 1 ? '#dc3545' : '#007bff';

  const handleMainMenu = () => {
    clearGame();
    history.push('/offline');
  };

  const buildGameOverMessage = () => {
    if (!result) return '';
    const { winner, timeout, loser } = result;
    const { p1 } = { p1: config.player1Name };
    const p2 = config.player2Name;
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        t('game.timeout_loss', { player: loserName }) +
        '\n' +
        t('game.game_over_winner', { player: winnerName })
      );
    }
    if (winner === 0) return t('game.game_over_draw');
    const winnerName = winner === 1 ? p1 : p2;
    return t('game.game_over_winner', { player: winnerName });
  };

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen scrollY={false} className="sk-game-content">
        <div className="sk-tab-section sk-game-stage ion-padding-horizontal">
          <div className="sk-game-header">
            <div className={`sk-player-info${currentPlayer === 1 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#dc3545' }}>
                {config.player1Name}
              </div>
              <div className="sk-player-score">{scores[1]}</div>
            </div>
            <div className="sk-status sk-status-desktop" style={{ color: statusColor }}>
              {isActive ? statusText : ''}
            </div>
            <div className={`sk-player-info${currentPlayer === 2 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#007bff' }}>
                {config.player2Name}
              </div>
              <div className="sk-player-score">{scores[2]}</div>
            </div>
          </div>

          {config.timerEnabled && isActive && (
            <div className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}>{seconds}</div>
          )}

          <GameBoard
            state={state}
            size={config.gridSize}
            history={placementHistory}
            onCellClick={placeDot}
            disabled={!isActive}
          />

          <div className="sk-game-controls">
            <IonButton className="sk-game-btn sk-game-btn-reset" onClick={() => setConfirmResetOpen(true)} fill="solid">
              <IonIcon slot="start" icon={refreshOutline} />
              {resetButtonLabel}
            </IonButton>
            <IonButton className="sk-game-btn sk-game-btn-menu" onClick={handleMainMenu} fill="solid">
              <IonIcon slot="start" icon={homeOutline} />
              {menuButtonLabel}
            </IonButton>
          </div>

          <div className="sk-status sk-status-mobile" style={{ color: statusColor }}>
            {isActive ? statusText : ''}
          </div>
        </div>

        <IonAlert
          isOpen={confirmResetOpen}
          onDidDismiss={() => setConfirmResetOpen(false)}
          header={t('game.confirm_reset_title')}
          message={t('game.confirm_reset_message')}
          buttons={[
            { text: t('game.no_button'), role: 'cancel' },
            {
              text: t('game.yes_button'),
              handler: () => {
                resetGame();
              }
            }
          ]}
        />

        <IonAlert
          cssClass="sk-alert-pre"
          isOpen={!!result}
          backdropDismiss={false}
          header={t('game.game_over_title')}
          message={buildGameOverMessage()}
          buttons={[
            {
              text: t('game.new_game_button'),
              handler: () => {
                clearGame();
                history.replace('/offline');
              }
            },
            {
              text: t('game.main_menu_button'),
              role: 'cancel',
              handler: () => {
                clearGame();
                history.replace('/offline');
              }
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
