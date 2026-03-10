const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const verifyFaces = async (idImagePath, selfieImagePath) => {
  const form = new FormData();
  form.append('id_image',     fs.createReadStream(idImagePath));
  form.append('selfie_image', fs.createReadStream(selfieImagePath));

  const { data } = await axios.post(
    `${process.env.FACE_SERVICE_URL}/verify-face`,
    form,
    { headers: form.getHeaders() }
  );
  return data;
};

module.exports = { verifyFaces };