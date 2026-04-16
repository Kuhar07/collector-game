import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, IonTabs } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import { I18nProvider } from './contexts/I18nContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { LocalGameProvider } from './contexts/LocalGameContext';

import TabBar from './components/TabBar';
import BackgroundCanvas from './components/BackgroundCanvas';

import OfflinePage from './pages/OfflinePage';
import OfflineGamePage from './pages/OfflineGamePage';
import OnlinePage from './pages/OnlinePage';
import AuthScreen from './pages/AuthScreen';
import LobbyScreen from './pages/LobbyScreen';
import WaitingRoom from './pages/WaitingRoom';
import JoinRoomForm from './pages/JoinRoomForm';
import OnlineGamePage from './pages/OnlineGamePage';
import LeaderboardPage from './pages/LeaderboardPage';

export default function App() {
  return (
    <IonApp>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <LocalGameProvider>
              <BackgroundCanvas />
              <IonReactRouter>
                <IonTabs>
                  <IonRouterOutlet>
                    <Route exact path="/offline" component={OfflinePage} />
                    <Route exact path="/offline/game" component={OfflineGamePage} />
                    <Route exact path="/online" component={OnlinePage} />
                    <Route exact path="/online/auth" component={AuthScreen} />
                    <Route exact path="/online/lobby" component={LobbyScreen} />
                    <Route exact path="/online/waiting/:code" component={WaitingRoom} />
                    <Route exact path="/online/join" component={JoinRoomForm} />
                    <Route exact path="/online/game/:id" component={OnlineGamePage} />
                    <Route exact path="/leaderboard" component={LeaderboardPage} />
                    <Route exact path="/">
                      <Redirect to="/offline" />
                    </Route>
                  </IonRouterOutlet>
                  <TabBar />
                </IonTabs>
              </IonReactRouter>
            </LocalGameProvider>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </IonApp>
  );
}
