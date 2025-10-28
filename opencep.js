import axios from 'axios';

export async function fetchCEP(cep) {
  const clean = String(cep || '').replace(/\D/g, '');
  if (!clean) throw new Error('CEP inválido');
  const { data } = await axios.get(`https://opencep.com.br/v1/${clean}`, { timeout: 10000 });
  return {
    logradouro: data.logradouro || '',
    cep: data.cep || cep,
    cidade: data.localidade || '',
    bairro: data.bairro || '',
    uf: data.uf || '',
    complemento: data.complemento || ''
  };
}
