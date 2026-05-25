import { useNavigate } from 'react-router-dom';
import { WorldIdVerify } from '../../components/voter/WorldIdVerify';

export default function SignIn() {
  const navigate = useNavigate();
  return <WorldIdVerify onBack={() => navigate('/')} />;
}
