import { AppProps } from 'next/app'; 
import { Provider } from 'react-redux';
import Head from 'next/head'; // นำเข้า Head
import { store } from '@/redux/store';
import 'bootstrap/dist/css/bootstrap.min.css';
import "@fortawesome/fontawesome-free/css/all.min.css";
import '@/styles/globals.css'
import "@/styles/navbar.scss";
import "@/styles/main.scss";
import MainLayouts from '@/components/Main/MainLayouts';
import { useRouter } from 'next/router';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import LoadPage from '@/components/LayoutPage/LoadPage';
import PageChange from '@/components/LayoutPage/PageChange';
import { GoogleMapsProvider } from '@/providers/GoogleMapsProvider';

const App = ({ Component, pageProps }: AppProps) => {
  const { title, description, slug, titleBar } = pageProps;
  const router = useRouter();
  const isAdminRoute = router.pathname.startsWith('/admin');

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    router.events.on('routeChangeStart', (url, { shallow }) => {
      document.body.classList.add('body-page-transition');
      setLoading(true);
    });
    router.events.on('routeChangeComplete', (url) => {
      document.body.classList.remove('body-page-transition');
      setLoading(false);
    });
    router.events.on('routeChangeError', (err, url) => {
      document.body.classList.remove('body-page-transition');
      setLoading(false);
    });

  }, []);

  return (
    <Provider store={store}>
      <Head>
        <link rel="icon" href="/favicon.ico" /> {/* เพิ่มการอ้างอิงถึงไอคอน */}
      </Head>
      <GoogleMapsProvider>
      {
        isAdminRoute ? (
          <AuthProvider>
            <AdminRoute>
              <MainLayouts title={title} description={description} slug={slug} titleBar={titleBar}>
                {loading && <PageChange />}
                <Component {...pageProps} />
              </MainLayouts>
            </AdminRoute>
          </AuthProvider>
        ) : (
          <MainLayouts title={title} description={description} slug={slug} titleBar={titleBar}>
            <Component {...pageProps} />
          </MainLayouts>
        )
      }
      </GoogleMapsProvider>
    </Provider>
  );
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated && router.pathname !== '/admin/login' && router.pathname !== '/admin/login_line') {
        router.replace('/admin/login');
      } else {
        setIsInitialLoad(false);
      }
    }
  }, [isAuthenticated, loading, router]);

  if (loading || isInitialLoad) {
    return <LoadPage />;
  }

  return <>{children}</>;
};

export default App;