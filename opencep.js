import axios from 'axios';

export async function fetchCEP(cep) {
  const clean = String(cep || '').replace(/\D/g, '');
  if (!clean) throw new Error('CEP inválido');
  const url = `https://opencep.com.br/v1/${clean}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  // data: { cep, logradouro, complemento, bairro, localidade, uf, ibge, ddd, siafi }
  return {
    logradouro: data.logradouro || '',
    cep: data.cep || cep,
    cidade: data.localidade || '',
    bairro: data.bairro || '',
    uf: data.uf || '',
    complemento: data.complemento || ''
  };
}
