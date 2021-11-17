import ExcelTemplateAdapter from '~/components/import/templateParsers/ExcelTemplateAdapter'

export default class ExcelUrlTemplateAdapter extends ExcelTemplateAdapter {
  constructor(url, $store) {
    const name = url.split('/').pop()
    super(name, null)
    this.url = url
    this.$store = $store
  }

  async init() {
    const res = await this.$store.dispatch('sqlMgr/ActSqlOp', [null, 'handleAxiosCall',
      [{
        url: this.url,
        responseType: 'arraybuffer'
      }]])
    this.excelData = res.data
    await super.init()
  }
}
