module.exports = function aptimeout(interaction) {
  if (interaction.client.tempData.apInterfaces.has(interaction.channel.id)) {
    let apinterface = interaction.client.tempData.apInterfaces.get(interaction.channel.id);
    if (apinterface.timeoutid < Date.now() - 7200000) {
      let message = { type: 'chat', content: 'Disconnecting after 6 hours. Reconnect if required.', };
      interaction.client.tempData.apInterfaces.get(interaction.channel.id).messageQueue.push(message);
      setTimeout((apinterface, interaction) => {
        apinterface.disconnect();
        interaction.client.tempData.apInterfaces.delete(interaction.channel.id);
      }, 10000);
    } else {
      setTimeout(aptimeout, 7200000, interaction);
    }
  }
};
